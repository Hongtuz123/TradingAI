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

// ---- 多時框數據模擬生成器 (支援 Vercel 靜態部署的多時框顯示) ----
function generateMockTimeframeData(dailyKline, resolution) {
  if (!dailyKline || dailyKline.length === 0) return [];
  if (resolution === '1D' || resolution === '1W' || resolution === '1M') {
    // 日/週/月時框直接返回或進行基礎聚合，這裡直接回傳日K
    return dailyKline;
  }

  const result = [];
  // 決定每天要生成的子 K 線數量
  let barsPerDay = 5; // 預設 1h
  let timeStepMinutes = 60;
  let daysToUse = 20; // 僅用最近幾天的數據來生成以維持合理數量

  if (resolution === '15m') {
    barsPerDay = 18; // 9:00 - 13:30 每 15 分鐘一根
    timeStepMinutes = 15;
    daysToUse = 6;  // 約 108 根 K 線，LWC 渲染最合適
  } else if (resolution === '1h') {
    barsPerDay = 5;
    timeStepMinutes = 60;
    daysToUse = 20; // 約 100 根 K 線
  } else if (resolution === '4h') {
    barsPerDay = 2;
    timeStepMinutes = 240;
    daysToUse = 50; // 約 100 根 K 線
  }

  // 取得最近部分的日K
  const startIdx = Math.max(0, dailyKline.length - daysToUse);
  const baseData = dailyKline.slice(startIdx);

  for (const day of baseData) {
    const dayOpen = parseFloat(day.open);
    const dayClose = parseFloat(day.close);
    const dayHigh = parseFloat(day.high);
    const dayLow = parseFloat(day.low);
    const dayVol = parseFloat(day.volume);

    // 模擬當天內部的價格隨機路徑，起點為 open，終點為 close，範圍在 low 到 high 之間
    const prices = [dayOpen];
    for (let j = 1; j < barsPerDay - 1; j++) {
      const progress = j / (barsPerDay - 1);
      // 漸進式朝 close 靠攏，但加上隨機震盪
      const targetVal = dayOpen + (dayClose - dayOpen) * progress;
      const noise = (Math.random() - 0.5) * (dayHigh - dayLow) * 0.4;
      let nextPrice = targetVal + noise;
      // 限制範圍
      nextPrice = Math.max(dayLow, Math.min(dayHigh, nextPrice));
      prices.push(+(nextPrice).toFixed(2));
    }
    prices.push(dayClose);

    // 生成當天每根分K
    for (let j = 0; j < barsPerDay; j++) {
      // 模擬時間：假設開盤為 09:00
      const hour = 9 + Math.floor((j * timeStepMinutes) / 60);
      const min = (j * timeStepMinutes) % 60;
      const hourStr = String(hour).padStart(2, '0');
      const minStr = String(min).padStart(2, '0');
      
      // 合併成時間字串 YYYY-MM-DD HH:mm:ss 或時間戳記
      const dateStr = `${day.date} ${hourStr}:${minStr}:00`;

      // 設定開高低收
      const openVal = prices[j];
      const closeVal = (j === barsPerDay - 1) ? dayClose : prices[j + 1];
      const maxBound = Math.max(openVal, closeVal);
      const minBound = Math.min(openVal, closeVal);

      // 上下影線隨機微幅震盪，不超出當天極限
      const highVal = Math.min(dayHigh, +(maxBound + Math.random() * (dayHigh - maxBound) * 0.5).toFixed(2));
      const lowVal = Math.max(dayLow, +(minBound - Math.random() * (minBound - dayLow) * 0.5).toFixed(2));
      
      result.push({
        date: dateStr,
        open: openVal,
        high: highVal,
        low: lowVal,
        close: closeVal,
        volume: Math.round(dayVol / barsPerDay * (0.7 + Math.random() * 0.6)),
      });
    }
  }

  return result;
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

  // 統一時間戳格式化：若是分K (包含空格或冒號) 則轉為 Unix 秒數，否則保持 YYYY-MM-DD
  const parseKlineTime = (dateStr) => {
    if (typeof dateStr === 'string' && (dateStr.includes(' ') || dateStr.includes(':'))) {
      const parsed = Math.floor(Date.parse(dateStr) / 1000);
      return isNaN(parsed) ? dateStr : parsed;
    }
    return dateStr;
  };

  // ---- 共用的格式化數據 ----
  const formattedCandles = klineData.map(d => ({
    time: parseKlineTime(d.date),
    open: parseFloat(d.open),
    high: parseFloat(d.high),
    low: parseFloat(d.low),
    close: parseFloat(d.close),
  }));

  const formattedVolume = klineData.map(d => ({
    time: parseKlineTime(d.date),
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

  // 全域策略啟用狀態
  if (window.supertrendEnabled === undefined) {
    window.supertrendEnabled = false;
  }

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

  // 保存 highlighter series 的陣列以方便後續動態添加/刪除
  const highlighterSeriesList = [];

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

    // 同步外部 Toggle Checkbox 狀態
    const toggleCheckbox = document.getElementById('enable-strategy-toggle');
    if (toggleCheckbox) {
      toggleCheckbox.checked = window.supertrendEnabled;
    }

    // 計算超級趨勢指標 (預設：ATR=10, 乘數=3)
    const supertrendData = calculateSupertrend(formattedCandles, 10, 3);

    // 實作策略回測功能
    function runSupertrendBacktest(candles, stData) {
      let equity = 1.0;
      let position = null; // null | { buyPrice, time }
      let trades = []; // 每次完成的交易
      let equityHistory = [1.0]; // 追蹤淨值歷史曲線

      for (let i = 1; i < stData.length; i++) {
        const prev = stData[i - 1];
        const curr = stData[i];
        
        // 尋找對應的 K 線價格
        const candle = candles.find(c => c.time === curr.time);
        if (!candle) continue;
        const price = parseFloat(candle.close);

        // 買入訊號: 當趨勢由空轉多 (-1 轉 1)
        if (prev.trend === -1 && curr.trend === 1) {
          if (position === null) {
            position = { buyPrice: price, time: curr.time };
          }
        }
        // 賣出訊號: 當趨勢由多轉空 (1 轉 -1)
        else if (prev.trend === 1 && curr.trend === -1) {
          if (position !== null) {
            const profitPct = (price - position.buyPrice) / position.buyPrice;
            equity = equity * (1 + profitPct);
            trades.push({
              buyPrice: position.buyPrice,
              sellPrice: price,
              profitPct: profitPct
            });
            equityHistory.push(equity);
            position = null;
          }
        }
      }

      // 處理最後一筆未平倉部位 (以最新收盤價作估算)
      if (position !== null && candles.length > 0) {
        const lastPrice = parseFloat(candles[candles.length - 1].close);
        const profitPct = (lastPrice - position.buyPrice) / position.buyPrice;
        equity = equity * (1 + profitPct);
        trades.push({
          buyPrice: position.buyPrice,
          sellPrice: lastPrice,
          profitPct: profitPct,
          unrealized: true
        });
        equityHistory.push(equity);
      }

      // 計算最大回撤 (Max Drawdown)
      let maxDrawdown = 0;
      let peak = 0;
      for (const eq of equityHistory) {
        if (eq > peak) {
          peak = eq;
        }
        const dd = peak > 0 ? (peak - eq) / peak : 0;
        if (dd > maxDrawdown) {
          maxDrawdown = dd;
        }
      }

      const totalTrades = trades.length;
      const totalProfitPct = (equity - 1.0) * 100;
      const mddPct = maxDrawdown * 100;

      return {
        totalTrades,
        totalProfitPct,
        mddPct
      };
    }

    // 當啟用 Supertrend 策略時，才渲染軌道與執行回測
    if (window.supertrendEnabled) {
      // 1. 執行回測運算並渲染統計面板
      const backtestResult = runSupertrendBacktest(formattedCandles, supertrendData);
      const summaryEl = document.getElementById('backtest-summary');
      if (summaryEl) {
        summaryEl.style.display = 'flex';
        const profitColor = backtestResult.totalProfitPct >= 0 ? 'var(--success)' : 'var(--danger)';
        summaryEl.innerHTML = `
          <span>📊 策略回測報告 (基數=1)</span>
          <span>交易次數: <strong style="color:var(--warning);">${backtestResult.totalTrades}</strong> 次</span>
          <span>累積獲利: <strong style="color:${profitColor};">${backtestResult.totalProfitPct >= 0 ? '+' : ''}${backtestResult.totalProfitPct.toFixed(2)}%</strong></span>
          <span>最大回撤: <strong style="color:var(--danger);">${backtestResult.mddPct.toFixed(2)}%</strong></span>
        `;
      }

      // 2. 準備上升與下降軌道數據（嚴格互斥：每個 bar 只屬於一種趨勢）
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

      // 3. 識別連續趨勢段，繪製 Highlighter 區塊
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
          // High-trend highlighter
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
          highlighterSeriesList.push(hlSeries);
        } else {
          // Low-trend highlighter
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
          highlighterSeriesList.push(hlSeries);
        }
      }

      // 4. 計算買賣轉折訊號標籤
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
              text: ' [ BUY ] ',
              size: 2.4,
            });
          } else if (prev.trend === 1 && curr.trend === -1) {
            sellMarkers.push({
              time: curr.time,
              position: 'aboveBar',
              color: '#ef4444',
              shape: 'arrowDown',
              text: ' [ SELL ] ',
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
    } else {
      // 策略未啟用時，隱藏績效看板
      const summaryEl = document.getElementById('backtest-summary');
      if (summaryEl) {
        summaryEl.style.display = 'none';
      }
      supertrendUpSeries.setData([]);
      supertrendDnSeries.setData([]);
    }

    mainChart.timeScale().fitContent();
    if (rsiChart) rsiChart.timeScale().fitContent();
    console.log(`[LWC] ${containerId}: ${klineData.length} candles rendered with Supertrend strategy toggle.`);
  } catch (err) {
    console.error('[LWC Error]', err);
    container.innerHTML = `<div style="color:var(--danger);padding:20px;">LWC Render Error: ${err.message}</div>`;
  }

  return mainChart;
}

// 動態圖層策略切換函式
window.toggleStrategyLayer = function(enabled) {
  window.supertrendEnabled = enabled;
  if (currentChartSymbol) {
    const stock = mockStocks.find(s => s.id === currentChartSymbol);
    if (stock) {
      loadTVChart(stock);
    }
  }
};

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
    console.warn("無法取得 API K 線，嘗試進入離線多時框模擬模式：", err.message);
    const stock = mockStocks.find(s => s.id === currentChartSymbol);
    if (stock && stock.kline && stock.kline.length > 0) {
      // 離線/靜態部署模式：依時框動態生成高擬真 K 線數據
      const simulatedKline = generateMockTimeframeData(stock.kline, res);
      currentKlineData = simulatedKline;
      currentLWChart = renderLWChart('tvChartContainer', simulatedKline);
    } else {
      container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted)">無可用資料 (${err.message})</div>`;
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

function renderChartStockList() {}
function filterChartList() {}
