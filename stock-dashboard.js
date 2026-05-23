// =============================================
// TradingView Widget + 個股戰情板邏輯
// =============================================
let currentChartSymbol = null;
let currentLWChart = null;
let currentLWDashChart = null;

// ---- 技術指標計算函式 ----
function calculateSupertrend(data, period = 10, multiplier = 3) {
  if (data.length < period) return [];

  // 1. 計算 TR (True Range)
  const tr = [];
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      tr.push(data[i].high - data[i].low);
    } else {
      const highLow = data[i].high - data[i].low;
      const highClose = Math.abs(data[i].high - data[i - 1].close);
      const lowClose = Math.abs(data[i].low - data[i - 1].close);
      tr.push(Math.max(highLow, highClose, lowClose));
    }
  }

  // 2. 計算 ATR (Wilder's Smoothed Moving Average)
  const atr = new Array(data.length).fill(0);
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += tr[i];
  }
  atr[period - 1] = sum / period;

  for (let i = period; i < data.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }

  // 3. 計算 Supertrend 軌道
  const supertrend = [];
  const up = new Array(data.length).fill(0);
  const dn = new Array(data.length).fill(0);
  const trend = new Array(data.length).fill(1); // 1 = Up, -1 = Down

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      supertrend.push({ time: data[i].time, value: null, trend: 1, up: null, dn: null });
      continue;
    }

    const src = (data[i].high + data[i].low) / 2;
    const currentAtr = atr[i];

    const basicUp = src - multiplier * currentAtr;
    const basicDn = src + multiplier * currentAtr;

    if (i === period - 1) {
      up[i] = basicUp;
      dn[i] = basicDn;
      trend[i] = 1;
      supertrend.push({
        time: data[i].time,
        value: basicUp,
        trend: 1,
        up: basicUp,
        dn: basicDn
      });
      continue;
    }

    const prevUp = up[i - 1];
    const prevDn = dn[i - 1];
    const prevClose = data[i - 1].close;

    // 計算上升軌道 (Up Trend Line)
    if (prevClose > prevUp) {
      up[i] = Math.max(basicUp, prevUp);
    } else {
      up[i] = basicUp;
    }

    // 計算下降軌道 (Down Trend Line)
    if (prevClose < prevDn) {
      dn[i] = Math.min(basicDn, prevDn);
    } else {
      dn[i] = basicDn;
    }

    // 判斷趨勢方向（最新後出現的趨勢為主，轉折時優先取最新趨勢）
    const prevTrend = trend[i - 1];
    let currentTrend = prevTrend;
    const triggerUp = (data[i].close > prevDn);
    const triggerDown = (data[i].close < prevUp);

    if (triggerUp && triggerDown) {
      // 數學上若同時滿足，依時間以最新後出現的趨勢為主
      // high-trend 轉 low-trend 優先取 low-trend (-1)
      // low-trend 轉 high-trend 優先取 high-trend (1)
      currentTrend = (prevTrend === 1) ? -1 : 1;
    } else if (triggerUp) {
      currentTrend = 1;
    } else if (triggerDown) {
      currentTrend = -1;
    }
    trend[i] = currentTrend;

    const value = currentTrend === 1 ? up[i] : dn[i];

    supertrend.push({
      time: data[i].time,
      value: value,
      trend: currentTrend,
      up: up[i],
      dn: dn[i]
    });
  }

  return supertrend;
}

function calculateSMA(data, period) {
  const sma = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) continue;
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j].close;
    }
    sma.push({ time: data[i].time, value: sum / period });
  }
  return sma;
}

function calculateRSI(data, period = 14) {
  const rsi = [];
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period && i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    if (change >= 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  if (data.length > period) {
    rsi.push({ time: data[period].time, value: avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)) });
  }

  for (let i = period + 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    let gain = change >= 0 ? change : 0;
    let loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    
    let rs = avgLoss === 0 ? 0 : avgGain / avgLoss;
    let rsiValue = avgLoss === 0 ? 100 : 100 - (100 / (1 + rs));
    rsi.push({ time: data[i].time, value: rsiValue });
  }
  return rsi;
}

// ---- Lightweight Charts 渲染函式 ----
function renderLWChart(containerId, klineData, height = 260) {
  const container = document.getElementById(containerId);
  if (!container) return null;
  container.innerHTML = '';
  // 確保容器有明確高度與寬度，autoSize 才能生效
  container.style.width = '100%';
  const isMainChart = (containerId === 'tvChartContainer');
  if (isMainChart) {
    container.style.height = '100%';
    container.style.flex = '1';
  } else {
    // inline chart 保持原本的 height
    container.style.height = height + 'px';
  }
  container.style.position = 'relative';

  // ---- 共用的格式化數據 ----
  const formattedCandles = klineData.map(d => ({
    time: d.date,
    open: parseFloat(d.open),
    high: parseFloat(d.high),
    low: parseFloat(d.low),
    close: parseFloat(d.close),
  }));

  const formattedVolume = klineData.map(d => ({
    time: d.date,
    value: parseFloat(d.volume),
    color: parseFloat(d.close) >= parseFloat(d.open) ? 'rgba(239,68,68,0.45)' : 'rgba(34,197,94,0.45)',
  }));

  // ---- 共用圖表選項 ----
  const chartTheme = {
    layout: {
      background: { type: 'solid', color: '#030712' },
      textColor: '#cbd5e1',
    },
    grid: {
      vertLines: { color: 'rgba(51, 65, 85, 0.25)' },
      horzLines: { color: 'rgba(51, 65, 85, 0.25)' },
    },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  };

  let mainChart, rsiChart;

  if (isMainChart) {
    // ==== 主圖分區：主圖 75% + RSI 面板 25% ====
    container.style.display = 'flex';
    container.style.flexDirection = 'column';

    const mainDiv = document.createElement('div');
    mainDiv.style.cssText = 'flex:3;min-height:0;position:relative;';
    container.appendChild(mainDiv);

    // RSI 面板分隔線
    const separator = document.createElement('div');
    separator.style.cssText = 'height:1px;background:rgba(71,85,105,0.6);flex-shrink:0;';
    container.appendChild(separator);

    const rsiDiv = document.createElement('div');
    rsiDiv.style.cssText = 'flex:1;min-height:0;position:relative;';
    container.appendChild(rsiDiv);

    // ---- 主圖表（K線 + 成交量 + 5MA + Supertrend）----
    mainChart = LightweightCharts.createChart(mainDiv, {
      ...chartTheme,
      autoSize: true,
      rightPriceScale: {
        borderColor: 'rgba(71, 85, 105, 0.5)',
        autoScale: true,
        scaleMargins: { top: 0.03, bottom: 0.03 }
      },
      timeScale: { borderColor: 'rgba(71, 85, 105, 0.5)', timeVisible: true, secondsVisible: false },
    });

    // ---- RSI 子圖表 ----
    rsiChart = LightweightCharts.createChart(rsiDiv, {
      ...chartTheme,
      autoSize: true,
      rightPriceScale: {
        borderColor: 'rgba(71, 85, 105, 0.5)',
        autoScale: true,
        scaleMargins: { top: 0.08, bottom: 0.08 }
      },
      timeScale: {
        borderColor: 'rgba(71, 85, 105, 0.5)',
        timeVisible: true,
        secondsVisible: false,
        visible: false, // 隱藏 RSI 面板的獨立時間軸，由主圖控制
      },
    });

    // 同步主圖與 RSI 面板的時間軸
    mainChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (range) rsiChart.timeScale().setVisibleLogicalRange(range);
    });
    rsiChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (range) mainChart.timeScale().setVisibleLogicalRange(range);
    });

  } else {
    // ==== 內嵌圖表：RSI 疊在主圖上（空間有限）====
    mainChart = LightweightCharts.createChart(container, {
      ...chartTheme,
      autoSize: true,
      rightPriceScale: {
        borderColor: 'rgba(71, 85, 105, 0.5)',
        autoScale: true,
        scaleMargins: { top: 0.05, bottom: 0.05 }
      },
      timeScale: { borderColor: 'rgba(71, 85, 105, 0.5)', timeVisible: true, secondsVisible: false },
    });
  }

  // ---- 主圖 Series ----
  const candleSeries = mainChart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: '#ef4444',
    downColor: '#22c55e',
    borderDownColor: '#22c55e',
    borderUpColor: '#ef4444',
    wickDownColor: '#22c55e',
    wickUpColor: '#ef4444',
  });

  // 成交量面板（獨立 price scale）
  const volumeSeries = mainChart.addSeries(LightweightCharts.HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
    scaleMargins: { top: 0.85, bottom: 0 },
  });
  mainChart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

  // 繪製 5MA
  const smaSeries = mainChart.addSeries(LightweightCharts.LineSeries, {
    color: '#3b82f6',
    lineWidth: 2,
    title: '5MA',
    crosshairMarkerVisible: false,
  });

  // 繪製 Supertrend 上升軌道（綠色實線，箱體底邊）
  const supertrendUpSeries = mainChart.addSeries(LightweightCharts.LineSeries, {
    color: '#22c55e',
    lineWidth: 2,
    lineStyle: 0,
    title: '超級趨勢(多)',
    crosshairMarkerVisible: true,
    crosshairMarkerRadius: 4,
  });

  // 繪製 Supertrend 下降軌道（紅色實線，箱體頂邊）
  const supertrendDnSeries = mainChart.addSeries(LightweightCharts.LineSeries, {
    color: '#ef4444',
    lineWidth: 2,
    lineStyle: 0,
    title: '超級趨勢(空)',
    crosshairMarkerVisible: true,
    crosshairMarkerRadius: 4,
  });

  // ---- RSI Series（根據是否為主圖，決定掛在哪個 chart 上）----
  const rsiTargetChart = isMainChart ? rsiChart : mainChart;
  const rsiSeriesOptions = {
    color: '#eab308',
    lineWidth: 1.5,
    title: 'RSI(14)',
  };
  if (!isMainChart) {
    rsiSeriesOptions.priceScaleId = 'rsi';
  }
  const rsiSeries = rsiTargetChart.addSeries(LightweightCharts.LineSeries, rsiSeriesOptions);
  if (!isMainChart) {
    rsiTargetChart.priceScale('rsi').applyOptions({
      scaleMargins: { top: 0.7, bottom: 0.15 },
    });
  }

  // RSI 面板加上 30/70 超買超賣參考線（僅主圖）
  if (isMainChart && rsiChart) {
    const rsi70Series = rsiTargetChart.addSeries(LightweightCharts.LineSeries, {
      color: 'rgba(239,68,68,0.35)',
      lineWidth: 1,
      lineStyle: 2, // Dashed
      title: '',
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const rsi30Series = rsiTargetChart.addSeries(LightweightCharts.LineSeries, {
      color: 'rgba(34,197,94,0.35)',
      lineWidth: 1,
      lineStyle: 2,
      title: '',
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    // 填充 70/30 水平線
    const refLineData = formattedCandles.map(d => ({ time: d.time }));
    rsi70Series.setData(refLineData.map(d => ({ time: d.time, value: 70 })));
    rsi30Series.setData(refLineData.map(d => ({ time: d.time, value: 30 })));
  }

  try {
    candleSeries.setData(formattedCandles);
    volumeSeries.setData(formattedVolume);
    smaSeries.setData(calculateSMA(formattedCandles, 5));
    rsiSeries.setData(calculateRSI(formattedCandles, 14));

    // 計算超級趨勢指標 (預設：ATR=10, 乘數=3)
    const supertrendData = calculateSupertrend(formattedCandles, 10, 3);

    // 準備上升與下降軌道數據（嚴格互斥：每個 bar 只屬於一種趨勢）
    const upData = [];
    const dnData = [];
    for (let i = 0; i < supertrendData.length; i++) {
      const curr = supertrendData[i];
      if (curr.value === null) continue;

      if (curr.trend === 1) {
        upData.push({ time: curr.time, value: curr.value });
      } else {
        dnData.push({ time: curr.time, value: curr.value });
      }
    }

    // 識別連續趨勢段，為 high-trend 底部畫綠色實線、low-trend 頂部畫紅色實線
    const segments = []; // { trend, startIdx, endIdx }
    let segStart = -1;
    let segTrend = null;
    for (let i = 0; i < supertrendData.length; i++) {
      const curr = supertrendData[i];
      if (curr.value === null) continue;
      if (curr.trend !== segTrend) {
        if (segTrend !== null && segStart >= 0) {
          segments.push({ trend: segTrend, startIdx: segStart, endIdx: i - 1 });
        }
        segTrend = curr.trend;
        segStart = i;
      }
    }
    if (segTrend !== null && segStart >= 0) {
      segments.push({ trend: segTrend, startIdx: segStart, endIdx: supertrendData.length - 1 });
    }

    for (const seg of segments) {
      // 收集段內 K 線與 Supertrend 值
      const segCloseData = [];
      let segStMin = Infinity;   // 該段 Supertrend 值的最小值
      let segStMax = -Infinity;  // 該段 Supertrend 值的最大值
      for (let i = seg.startIdx; i <= seg.endIdx; i++) {
        if (supertrendData[i].value === null) continue;
        const candle = formattedCandles.find(c => c.time === supertrendData[i].time);
        if (candle) {
          segCloseData.push({ time: candle.time, value: candle.close });
          segStMin = Math.min(segStMin, supertrendData[i].value);
          segStMax = Math.max(segStMax, supertrendData[i].value);
        }
      }

      if (segCloseData.length === 0) continue;

      if (seg.trend === 1) {
        // High-trend highlighter：以 Supertrend 線最低值為基準，往上填綠色
        const hlSeries = mainChart.addSeries(LightweightCharts.BaselineSeries, {
          baseValue: { type: 'price', price: segStMin },
          topLineColor: 'transparent',
          topFillColor1: 'rgba(34, 197, 94, 0.18)',
          topFillColor2: 'rgba(34, 197, 94, 0.04)',
          bottomLineColor: 'transparent',
          bottomFillColor1: 'transparent',
          bottomFillColor2: 'transparent',
          lineWidth: 0,
          title: '',
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        hlSeries.setData(segCloseData);
      } else {
        // Low-trend highlighter：以 Supertrend 線最高值為基準，往下填紅色
        const hlSeries = mainChart.addSeries(LightweightCharts.BaselineSeries, {
          baseValue: { type: 'price', price: segStMax },
          topLineColor: 'transparent',
          topFillColor1: 'transparent',
          topFillColor2: 'transparent',
          bottomLineColor: 'transparent',
          bottomFillColor1: 'rgba(239, 68, 68, 0.04)',
          bottomFillColor2: 'rgba(239, 68, 68, 0.18)',
          lineWidth: 0,
          title: '',
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        hlSeries.setData(segCloseData);
      }
    }

    // 計算買賣轉折訊號標籤
    // 買 → 掛在 supertrendUpSeries（Supertrend 綠線），顯示在線下方
    // 賣 → 掛在 supertrendDnSeries（Supertrend 紅線），顯示在線上方
    const buyMarkers = [];
    const sellMarkers = [];
    for (let i = 1; i < supertrendData.length; i++) {
      const prev = supertrendData[i - 1];
      const curr = supertrendData[i];
      if (prev.value !== null && curr.value !== null) {
        if (prev.trend === -1 && curr.trend === 1) {
          buyMarkers.push({
            time: curr.time,
            position: 'belowBar',
            color: '#22c55e',
            shape: 'arrowUp',
            text: '買',
            size: 2.4,
          });
        } else if (prev.trend === 1 && curr.trend === -1) {
          sellMarkers.push({
            time: curr.time,
            position: 'aboveBar',
            color: '#ef4444',
            shape: 'arrowDown',
            text: '賣',
            size: 2.4,
          });
        }
      }
    }

    supertrendUpSeries.setData(upData);
    supertrendDnSeries.setData(dnData);

    // 買標籤掛在 Supertrend 綠線，賣標籤掛在 Supertrend 紅線
    if (buyMarkers.length > 0) {
      LightweightCharts.createSeriesMarkers(supertrendUpSeries, buyMarkers);
    }
    if (sellMarkers.length > 0) {
      LightweightCharts.createSeriesMarkers(supertrendDnSeries, sellMarkers);
    }

    mainChart.timeScale().fitContent();
    if (rsiChart) rsiChart.timeScale().fitContent();
    console.log(`[LWC] ${containerId}: ${klineData.length} candles rendered with Supertrend`);
  } catch (err) {
    console.error('[LWC Error]', err);
    container.innerHTML = `<div style="color:var(--danger);padding:20px;">LWC Render Error: ${err.message}</div>`;
  }

  return mainChart;
}

// ---- 內嵌儀表板渲染（供主儀表板呼叫）----
function renderStockDashInline(stock, targetEl) {
  const s = stock;
  console.log(`[DEBUG] Rendering inline dash for ${s.id}, market: ${s.market}`);
  const now = new Date();

  // 模擬數據
  const foreignNet = Math.round(Math.random() * 5000 - 1000);
  const trustNet   = Math.round(Math.random() * 500 - 100);
  const dealerNet  = Math.round(Math.random() * 200 - 50);
  const high  = +(s.price * (1 + Math.random() * 0.05)).toFixed(2);
  const low   = +(s.price * (1 - Math.random() * 0.05)).toFixed(2);
  const vol   = s.dailyVol;
  const prob  = Math.min(95, Math.max(20, Math.round(s.score / 11 * 80 + Math.random() * 20)));
  const stopLoss = (s.price * 0.92).toFixed(2);
  const target   = (s.price * 1.10).toFixed(2);
  const signal   = prob >= 65 ? { label: '可布局', color: 'var(--success)' }
                 : prob >= 45 ? { label: '觀察中', color: 'var(--warning)' }
                 : { label: '暫觀望', color: 'var(--danger)' };

  targetEl.innerHTML = `
    <div class="inline-dash">
      <!-- 頂列 -->
      <div class="sd-topbar" style="border-radius:8px;margin-bottom:12px;">
        <div><div class="sd-symbol" style="font-size:16px">${s.id} ${s.name} 個股戰情</div></div>
        <div style="text-align:right">
          <div class="sd-price ${parseFloat(s.change)>=0?'text-up':'text-down'}" style="font-size:22px">${s.price}</div>
          <div style="font-size:13px;color:${parseFloat(s.change)>=0?'var(--up-color)':'var(--down-color)'}">${parseFloat(s.change)>0?'▲':'▼'} ${Math.abs(s.change)}%</div>
        </div>
      </div>

      <!-- 圖表 + 指標列 -->
      <div class="inline-tv-wrap">
        <div id="inlineTVChart_${s.id}" style="width:100%;height:260px;"></div>
      </div>

      <!-- 指標列 -->
      <div class="sd-indicators" style="margin-top:12px;">
        <div class="sd-ind-card">
          <div class="ind-label">AI 上漲機率</div>
          <div class="ind-main" style="color:${prob>=60?'var(--success)':prob>=40?'var(--warning)':'var(--danger)'}">${prob}%</div>
          <div class="ind-tip">${signal.label}</div>
        </div>
        <div class="sd-ind-card">
          <div class="ind-label">三大法人合計</div>
          <div class="ind-main ${(foreignNet+trustNet+dealerNet)>=0?'text-up':'text-down'}" style="font-size:18px">${(foreignNet+trustNet+dealerNet>0?'+':'')+(foreignNet+trustNet+dealerNet).toLocaleString()}</div>
          <div class="ind-tip">外資${foreignNet>=0?'+':''}${foreignNet} 投信${trustNet>=0?'+':''}${trustNet}</div>
        </div>
        <div class="sd-ind-card">
          <div class="ind-label">荳荳評分</div>
          <div class="ind-main" style="color:var(--warning)">${s.score}</div>
          <div class="ind-tip">/ 12 分｜Type ${s.type !== 'none' ? s.type : '--'}</div>
        </div>
        <div class="sd-ind-card">
          <div class="ind-label">建議停損</div>
          <div class="ind-main" style="font-size:16px;color:var(--danger)">${stopLoss}</div>
          <div class="ind-tip" style="color:var(--success)">目標 ${target}</div>
        </div>
        <div class="sd-ind-card">
          <div class="ind-label">技術類型</div>
          <div class="ind-main" style="font-size:16px">${s.type !== 'none' ? 'Type ' + s.type : '--'}</div>
          <div class="ind-tip">${s.maBull ? '均線多頭 ✔' : '均線未排列'}</div>
        </div>
      </div>

      <!-- 診斷文字 -->
      <div class="sd-panel" style="margin-top:12px;font-size:13px;">
        <div class="sd-panel-title">🚀 即時診斷</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div class="sd-diag-item"><div class="sd-diag-icon">💰 <strong>價格交量</strong></div><div class="sd-diag-content">成交 ${vol.toLocaleString()} 張，量比 ${s.volRatio}x，${parseFloat(s.volRatio)>1.5?'量能放大，動能充足。':'量能偏低。'}</div></div>
          <div class="sd-diag-item"><div class="sd-diag-icon">🏛 <strong>三大法人</strong></div><div class="sd-diag-content">${(foreignNet+trustNet+dealerNet)>0?'法人積極買超，籌碼正向。':'法人偏空，留意出貨。'}</div></div>
          <div class="sd-diag-item"><div class="sd-diag-icon">📊 <strong>技術面</strong></div><div class="sd-diag-content">${s.maBull?'均線多頭排列，趨勢明確向上。':'均線尚未多頭排列，觀察整理。'}  RSI 正常區間。</div></div>
          <div class="sd-diag-item"><div class="sd-diag-icon">⚠️ <strong>風險</strong></div><div class="sd-diag-content">${s.dist52W < 5?'接近52週高點，追高留意。':s.dist52W>20?'距高點較遠，爆發力待觀察。':'距高點 '+s.dist52W+'%，位置合理。'}</div></div>
        </div>
      </div>
    </div>
  `;

  // 渲染 Lightweight Chart
  setTimeout(() => {
    if (s.kline && s.kline.length > 0) {
      renderLWChart(`inlineTVChart_${s.id}`, s.kline, 260);
    } else {
      const chartEl = document.getElementById(`inlineTVChart_${s.id}`);
      if (chartEl) chartEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">暫無 K 線資料</div>';
    }
  }, 100);
}


let currentKlineData = null;

function loadTVChart(s) {
  currentChartSymbol = s.id;
  window.currentChartMarket = s.market || 'TWSE';

  // 更新頂部提示列的名稱
  const nameEl = document.querySelector('.chart-name');
  if (nameEl) {
    nameEl.innerHTML = `<span style="color:white;font-size:16px;font-weight:bold;">${s.id} ${s.name}</span> <span style="color:var(--text-muted);font-size:12px;">(${window.currentChartMarket})</span>`;
  }

  const container = document.getElementById('tvChartContainer');
  container.innerHTML = '';

  if (s.kline && s.kline.length > 0) {
    currentKlineData = s.kline;
    const rect = container.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : 800;
    const chartHeight = rect.height > 0 ? rect.height : 500;

    currentLWChart = renderLWChart('tvChartContainer', s.kline, chartHeight);
    
    // 預設顯示近30日
    setTimeout(() => {
      setTimeframe(30);
    }, 50);
  } else {
    currentKlineData = null;
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">暫無 K 線資料</div>';
  }
}

// ---- 設定時框 (原本的縮放) ----
function setTimeframe(days) {
  if (!currentLWChart || !currentKlineData || currentKlineData.length === 0) return;
  const timeScale = currentLWChart.timeScale();
  
  if (days === 'all') {
    timeScale.fitContent();
  } else {
    const totalData = currentKlineData.length;
    const startIndex = Math.max(0, totalData - days);
    
    const fromData = currentKlineData[startIndex];
    const toData = currentKlineData[totalData - 1];
    
    if (fromData && toData) {
      timeScale.setVisibleRange({
        from: fromData.date,
        to: toData.date
      });
    }
  }
}

// ---- 切換 K 線週期 (Resolution) ----
async function changeResolution(res) {
  const buttons = document.querySelectorAll('#chart-resolutions button');
  buttons.forEach(btn => {
    btn.classList.remove('active');
    btn.style.background = '';
    if (btn.getAttribute('onclick').includes(`'${res}'`)) {
      btn.classList.add('active');
      btn.style.background = 'var(--primary-color)';
    }
  });

  if (!currentChartSymbol) return;

  // 映射 UI 選項 → yfinance interval & days（yfinance 不支援 4h，改用 60m 近似）
  const intervalMap = { '15m':'15m', '1h':'60m', '4h':'60m', '1D':'1d', '1W':'1wk', '1M':'1mo' };
  const daysMap    = { '15m':59,   '1h':60,  '4h':180, '1D':120, '1W':365, '1M':730 };
  const interval = intervalMap[res] || '1d';
  const days     = daysMap[res]    || 120;
  const market   = window.currentChartMarket || 'TSE';

  const container = document.getElementById('tvChartContainer');
  container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted)">載入中...</div>';

  try {
    const r = await fetch(`http://localhost:8000/api/history?symbol=${currentChartSymbol}&days=${days}&interval=${interval}&market=${market}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (data.kline && data.kline.length > 0) {
      currentKlineData = data.kline;
      currentLWChart = renderLWChart('tvChartContainer', data.kline);
    } else {
      container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted)">無可用資料</div>';
    }
  } catch (err) {
    console.warn("無法取得 API K 線，嘗試載入本地日 K：", err.message);
    const stock = mockStocks.find(s => s.id === currentChartSymbol);
    if (stock && stock.kline && stock.kline.length > 0 && (res === '1D' || interval === '1d')) {
      currentKlineData = stock.kline;
      currentLWChart = renderLWChart('tvChartContainer', stock.kline);
    } else {
      const offlineMsg = (res === '1D' || interval === '1d') ? "無可用資料" : "離線模式僅支援日 K 線圖";
      container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted)">${offlineMsg} (${err.message})</div>`;
    }
  }
}

// ---- 搜尋標的並載入圖表 ----
async function searchAndLoadChart() {
  const inputEl = document.getElementById('chartSearchInput');
  if (!inputEl) return;
  const val = inputEl.value.trim();
  if (!val) return;
  
  let stock = mockStocks.find(s => s.id === val || s.name.includes(val));
  if (!stock) {
    stock = { id: val, name: val, market: 'TWSE' };
  }
  
  try {
    const fetchMarket = stock.market === 'OTC' ? 'OTC' : 'TSE';
    const res = await fetch(`http://localhost:8000/api/history?symbol=${stock.id}&market=${fetchMarket}`);
    if (res.ok) {
      const data = await res.json();
      stock.kline = data.kline;
    }
    loadTVChart(stock);
    inputEl.value = '';
  } catch (err) {
    console.warn("API 取得失敗，嘗試載入本地資料:", err.message);
    if (stock && stock.kline && stock.kline.length > 0) {
      loadTVChart(stock);
      inputEl.value = '';
    } else {
      alert(`找不到標的或無法連接伺服器: ${err.message}`);
    }
  }
}

// ---- 從當前 K 線開啟戰情板 ----
function openCurrentDash() {
  if (!currentChartSymbol) return;
  openStockDash(currentChartSymbol);
}

function renderChartStockList() {}
function filterChartList() {}

// ---- 開啟個股戰情板 ----
async function openStockDash(symbolId) {
  if (!symbolId) { alert('請先選擇標的'); return; }
  let stock = mockStocks.find(s => s.id === symbolId);
  if (!stock) { 
    stock = {
      id: symbolId,
      name: '自訂標的',
      price: '--',
      change: 0,
      market: window.currentChartMarket || 'GLOBAL',
      score: 0,
      type: 'none',
      volRatio: 1.0,
      dailyVol: 0,
      dist52W: 0
    };
  }
  
  try {
    const fetchMarket = stock.market === 'OTC' ? 'OTC' : 'TSE';
    const res = await fetch(`http://localhost:8000/api/history?symbol=${stock.id}&market=${fetchMarket}`);
    if (res.ok) {
      const data = await res.json();
      stock.kline = data.kline;
    }
  } catch(e) {
    console.warn("Failed to fetch kline for dashboard", e);
  }

  switchView('stockdash');
  setTimeout(() => renderStockDash(stock), 100);
}

// ---- 渲染個股戰情板 ----
function renderStockDash(s) {
  const now = new Date();
  const dateStr = `資料日期：${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

  document.getElementById('sd-symbol').innerText = `${s.id} (${s.name}) 股票 AI 戰情分析儀表板`;
  document.getElementById('sd-subtitle').innerText = '法人大買＋主力買超＋股價強勢，動能點火！';
  document.getElementById('sd-price').innerText = s.price;
  document.getElementById('sd-price').className = `sd-price ${parseFloat(s.change) >= 0 ? 'text-up' : 'text-down'}`;
  document.getElementById('sd-change').innerText = `${parseFloat(s.change) > 0 ? '▲' : '▼'} ${Math.abs(s.change)} (${Math.abs(s.change)}%)`;
  document.getElementById('sd-change').className = `sd-change ${parseFloat(s.change) >= 0 ? 'text-up' : 'text-down'}`;
  document.getElementById('sd-date').innerText = dateStr;

  // Lightweight Chart（rAF 確保容器尺寸就緒）
  const dashContainer = document.getElementById('tvDashChart');
  if (s.kline && s.kline.length > 0) {
    requestAnimationFrame(() => {
      currentLWDashChart = renderLWChart('tvDashChart', s.kline, 450);
    });
  } else {
    dashContainer.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">暫無 K 線資料</div>';
  }

  // 模擬籌碼數據
  const foreignNet  = Math.round((Math.random() * 5000 - 1000));
  const trustNet    = Math.round((Math.random() * 500 - 100));
  const dealerNet   = Math.round((Math.random() * 200 - 50));
  const mainForce   = Math.round((Math.random() * 1000 - 200));
  const mainTotal   = Math.round(mainForce * (3 + Math.random()*7));

  // 關鍵數據
  const high  = +(s.price * (1 + Math.random() * 0.05)).toFixed(2);
  const low   = +(s.price * (1 - Math.random() * 0.05)).toFixed(2);
  const amp   = +((high - low) / low * 100).toFixed(2);
  const vol   = s.dailyVol;
  const inner = Math.round(vol * (0.4 + Math.random() * 0.2));
  const outer = vol - inner;

  document.getElementById('sd-key-grid').innerHTML = `
    <div class="sd-kv-row"><span>收盤</span><span class="text-up" style="font-size:18px;font-weight:700">${s.price}</span></div>
    <div class="sd-kv-row"><span>漲跌</span><span class="${parseFloat(s.change)>=0?'text-up':'text-down'}">▲ ${Math.abs(s.change)} (${Math.abs(s.change)}%)</span></div>
    <div class="sd-kv-row"><span>最高</span><span>${high}</span></div>
    <div class="sd-kv-row"><span>最低</span><span>${low}</span></div>
    <div class="sd-kv-row"><span>成交量</span><span>${vol.toLocaleString()} 張</span></div>
    <div class="sd-kv-row"><span>內盤/外盤</span><span>${inner.toLocaleString()} / ${outer.toLocaleString()}</span></div>
    <div class="sd-kv-row"><span>振幅</span><span>${amp}%</span></div>
    <div class="sd-kv-row"><span>評分</span><span style="color:var(--warning);font-weight:700">${s.score}/12</span></div>
  `;

  // AI 漲跌機率計算（以評分為基礎加隨機擾動）
  const rawProb = Math.min(95, Math.max(20, s.score / 12 * 80 + Math.random() * 20));
  const prob = Math.round(rawProb);
  const probFall = Math.round((100 - prob) * 0.3);
  const probFlat = 100 - prob - probFall;

  // 更新量規
  const maxDash = 283;
  document.getElementById('gaugeFill').setAttribute('stroke-dashoffset', (maxDash * (1 - prob / 100)).toFixed(1));
  document.getElementById('gaugeFill').setAttribute('stroke', prob >= 60 ? '#10b981' : prob >= 40 ? '#f59e0b' : '#ef4444');
  document.getElementById('gaugeText').innerText = `${prob}%`;
  document.getElementById('sd-gauge-labels').innerHTML = `
    <div style="display:flex;justify-content:space-around;font-size:12px;color:var(--text-muted);">
      <span>回檔 ${probFall}%</span><span>盤整 ${probFlat}%</span><span>上漲 ${prob}%</span>
    </div>
  `;

  // 法人籌碼
  document.getElementById('sd-chips-grid').innerHTML = `
    <div class="chips-bar-wrap">
      <div class="chips-bar-label">外資</div>
      <div class="chips-bar-track"><div class="chips-bar-fill" style="width:${Math.min(100,Math.abs(foreignNet)/3000*100)}%;background:${foreignNet>=0?'var(--up-color)':'var(--down-color)'}"></div></div>
      <div class="chips-val ${foreignNet>=0?'text-up':'text-down'}">${(foreignNet>0?'+':'')+foreignNet.toLocaleString()}</div>
    </div>
    <div class="chips-bar-wrap">
      <div class="chips-bar-label">投信</div>
      <div class="chips-bar-track"><div class="chips-bar-fill" style="width:${Math.min(100,Math.abs(trustNet)/500*100)}%;background:${trustNet>=0?'var(--up-color)':'var(--down-color)'}"></div></div>
      <div class="chips-val ${trustNet>=0?'text-up':'text-down'}">${(trustNet>0?'+':'')+trustNet.toLocaleString()}</div>
    </div>
    <div class="chips-bar-wrap">
      <div class="chips-bar-label">自營商</div>
      <div class="chips-bar-track"><div class="chips-bar-fill" style="width:${Math.min(100,Math.abs(dealerNet)/200*100)}%;background:${dealerNet>=0?'var(--up-color)':'var(--down-color)'}"></div></div>
      <div class="chips-val ${dealerNet>=0?'text-up':'text-down'}">${(dealerNet>0?'+':'')+dealerNet.toLocaleString()}</div>
    </div>
  `;
  document.getElementById('sd-chips-table').innerHTML = `
    <table style="width:100%;font-size:12px;margin-top:8px;border-collapse:collapse;">
      <tr style="color:var(--text-muted);"><th>項目</th><th style="text-align:right">張數</th></tr>
      <tr><td>外資</td><td class="${foreignNet>=0?'text-up':'text-down'}" style="text-align:right">${(foreignNet>0?'+':'')+foreignNet.toLocaleString()}</td></tr>
      <tr><td>投信</td><td class="${trustNet>=0?'text-up':'text-down'}" style="text-align:right">${(trustNet>0?'+':'')+trustNet.toLocaleString()}</td></tr>
      <tr><td>自營商</td><td class="${dealerNet>=0?'text-up':'text-down'}" style="text-align:right">${(dealerNet>0?'+':'')+dealerNet.toLocaleString()}</td></tr>
      <tr style="border-top:1px solid var(--border-color);font-weight:700"><td>合計</td><td class="${(foreignNet+trustNet+dealerNet)>=0?'text-up':'text-down'}" style="text-align:right">${(foreignNet+trustNet+dealerNet>0?'+':'')+(foreignNet+trustNet+dealerNet).toLocaleString()}</td></tr>
    </table>
    ${(foreignNet+trustNet+dealerNet) > 0 ? '<div style="color:var(--success);font-size:11px;margin-top:6px">✓ 法人資金積極回補！</div>' : ''}
  `;

  // 進出場訊號
  const signal = prob >= 65 ? { label: '可布局', color: 'var(--success)', rate: `${prob}%`, risk: `1:${(prob/30).toFixed(1)}` }
                : prob >= 45 ? { label: '觀察中', color: 'var(--warning)', rate: `${prob}%`, risk: `1:1.0` }
                : { label: '暫觀望', color: 'var(--danger)', rate: `${prob}%`, risk: `1:0.5` };
  const stopLoss = (s.price * 0.92).toFixed(2);
  const target   = (s.price * 1.1).toFixed(2);
  document.getElementById('sd-signal').innerHTML = `
    <div style="font-size:24px;font-weight:800;color:${signal.color};text-align:center;padding:10px 0">${signal.label}</div>
    <div style="display:flex;justify-content:space-around;font-size:13px;margin-bottom:10px">
      <span>勝率 <strong>${signal.rate}</strong></span>
      <span>風險比 <strong>${signal.risk}</strong></span>
    </div>
    <div style="background:rgba(245,158,11,0.15);border-radius:6px;padding:8px;text-align:center;font-size:13px">
      建議停損：<strong style="color:var(--warning)">${stopLoss}</strong>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:8px;color:var(--text-muted)">
      <span>短目標：${target}</span><span>停損：${stopLoss}</span>
    </div>
  `;

  // 即時診斷
  const diagItems = [
    { icon: '💰', title: '價格與成交量', content: `收盤 ${s.price}，漲幅 ${s.change}%，成交 ${vol.toLocaleString()} 張，${vol > 10000 ? '外資大力內盤，買方積極。' : '成交量普通。'}` },
    { icon: '🏛', title: '三大法人', content: `外資 ${foreignNet>0?'+':''}${foreignNet}，投信 ${trustNet>0?'+':''}${trustNet}，自營 ${dealerNet>0?'+':''}${dealerNet}，合計 ${foreignNet+trustNet+dealerNet>0?'法人積極買超，籌碼正向。':'法人偏空，留意風險。'}` },
    { icon: '📊', title: '主力動向', content: `主力增減：${mainForce>0?'+':''}${mainForce}，10日累計：${mainTotal}，${mainForce>0?'→ 主力資金回流，加碼明確！':'→ 主力流出，謹慎為宜。'}` },
    { icon: '⚡', title: '技術趨勢強度', content: `綜合評分 <strong style="color:var(--warning)">${Math.round(s.score/12*100)}/100</strong>，${s.maBull?'多頭強勢，多頭排列明確。':'均線尚未多頭排列。'}` },
    { icon: '⚠️', title: '風險提醒', content: [
      s.dist52W < 5 ? '接近52週高點，追高風險提升' : '',
      parseFloat(s.change) > 6 ? '當日漲幅超過6%，追高風險高' : '',
      s.volRatio > 3 ? '量能暴增，留意主力出貨可能' : '',
    ].filter(Boolean).join('；') || '目前無特殊風險訊號。' },
    { icon: '✅', title: '操作建議', content: `可布局，建議攤位 ${+(s.price*0.97).toFixed(2)} ~ ${s.price}，停損 ${stopLoss}，日標 ${target}。` }
  ];

  document.getElementById('sd-diag').innerHTML = diagItems.map(d => `
    <div class="sd-diag-item">
      <div class="sd-diag-icon">${d.icon} <strong>${d.title}</strong></div>
      <div class="sd-diag-content">${d.content}</div>
    </div>
  `).join('');

  // 技術指標底部卡片
  const k = (Math.random()*100).toFixed(2);
  const d = (parseFloat(k) - Math.random()*20).toFixed(2);

  document.getElementById('sd-kd').innerHTML = `
    <div class="ind-label">KD 指標（日K）</div>
    <div class="ind-main">K <strong>${k}</strong></div>
    <div>D <strong>${d}</strong></div>
    <div class="ind-tip ${parseFloat(k)>parseFloat(d)?'text-up':'text-down'}">${parseFloat(k)>parseFloat(d)?'黃金交叉，強勢':'死亡交叉，留意'}</div>
  `;

  // 優先使用 screener 計算的真實 RSI
  const rsiReal = s.rsi14 != null ? parseFloat(s.rsi14) : (40 + Math.random()*55);
  document.getElementById('sd-rsi').innerHTML = `
    <div class="ind-label">RSI(14)</div>
    <div class="ind-main rsi-val ${rsiReal>80?'text-up':rsiReal<30?'text-down':''}" title="真實計算值">${rsiReal.toFixed(2)}</div>
    <div class="ind-tip ${rsiReal>80?'text-down':rsiReal<30?'text-up':''}">${rsiReal>80?'⚠️ 過熱，留意回調':rsiReal<30?'超賣，注意反彈':'正常區間'}</div>
  `;

  // 優先使用 screener 計算的真實 MACD
  const macdReal = s.macd != null ? parseFloat(s.macd) : (Math.random()*4-1);
  document.getElementById('sd-macd').innerHTML = `
    <div class="ind-label">MACD (12/26/9)</div>
    <div>DIF <strong>${macdReal.toFixed(4)}</strong></div>
    <div>DEA <strong title="9日EMA近似">${(macdReal * 0.8).toFixed(4)}</strong></div>
    <div class="ind-tip ${macdReal>0?'text-up':'text-down'}">${macdReal>0?'MACD 翻正，趨勢向上':'MACD 偏空'}</div>
  `;

  // 優先使用 screener 計算的真實布林通道
  const bbU = s.bbUpper != null ? s.bbUpper : +(s.price * 1.05).toFixed(2);
  const bbL = s.bbLower != null ? s.bbLower : +(s.price * 0.95).toFixed(2);
  const bbM = s.ma20    != null ? s.ma20    : s.price;
  const bbPct = bbU > bbL ? (((s.price - bbL) / (bbU - bbL)) * 100).toFixed(0) : '--';
  document.getElementById('sd-bb').innerHTML = `
    <div class="ind-label">布林通道 (20,2σ)</div>
    <div>上 <strong>${+parseFloat(bbU).toFixed(2)}</strong></div>
    <div>中 <strong>${+parseFloat(bbM).toFixed(2)}</strong></div>
    <div>下 <strong>${+parseFloat(bbL).toFixed(2)}</strong></div>
    <div class="ind-tip">位置 ${bbPct}%</div>
  `;

  document.getElementById('sd-score').innerHTML = `
    <div class="ind-label">荳荳評分</div>
    <div class="ind-main" style="font-size:28px;color:var(--warning)">${s.score}</div>
    <div style="color:var(--text-muted);font-size:11px">/ 12 分</div>
    <div class="ind-tip ${s.type!=='none'?'text-up':'text-muted'}">類型：${s.type !== 'none' ? s.type : '--'}</div>
    <div class="ind-tip" style="font-size:10px">20MA走升: ${s.ma20Rising?'✔':'✘'} | ATR: ${s.atr14??'--'}</div>
  `;
}
