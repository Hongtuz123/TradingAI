// =============================================
// TradingView Widget + 個股戰情板邏輯
// =============================================
let currentChartSymbol = null;
let currentLWChart = null;
let currentLWDashChart = null;

// 全域策略選擇狀態：'none' | 'supertrend' | 'trendline'
if (window.activeStrategy === undefined) {
  window.activeStrategy = 'none';
}

// ---- 下行趨勢線突破策略技術函式 ----

// 尋找高點 Pivot Highs 左右各 3 根極大值，並保證在 t 日是已經收盤確認的 (也就是高點 index <= t - 3)
function getPivotHighsUntil(candles, t) {
  const pivots = [];
  const left = 3;
  const right = 3;
  for (let i = left; i <= t - right; i++) {
    const targetHigh = parseFloat(candles[i].high);
    let isPivot = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i || j >= candles.length) continue;
      if (parseFloat(candles[j].high) >= targetHigh) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) {
      pivots.push({ index: i, time: candles[i].time, high: targetHigh });
    }
  }
  return pivots;
}

// 計算 t 日時點的趨勢線資訊 (保證無未來數據)
function calculateTrendlineAt(candles, t) {
  const pivots = getPivotHighsUntil(candles, t);
  if (pivots.length < 2) return null;

  // 尋找符合下行條件 (H1 > H2) 且在過去25天內有確認點的最鄰近高點連線
  let found = false;
  let idx1 = pivots.length - 2;
  let idx2 = pivots.length - 1;
  while (idx2 > 0) {
    idx1 = idx2 - 1;
    while (idx1 >= 0) {
      if (pivots[idx1].high > pivots[idx2].high) {
        found = true;
        break;
      }
      idx1--;
    }
    if (found) break;
    idx2--;
  }
  if (!found) return null;

  const pt2 = pivots[idx2];
  const pt1 = pivots[idx1];

  // 限制最近的確認點不能太遙遠，確保具有即時參考性 (在25天內)
  if (t - pt2.index > 25) return null;

  const slope = (pt2.high - pt1.high) / (pt2.index - pt1.index);
  const valAtT = pt2.high + slope * (t - pt2.index);
  const valAtPrev = pt2.high + slope * (t - 1 - pt2.index);
  return { value: valAtT, prevValue: valAtPrev, pt1, pt2, slope };
}

// 計算成交量的 20MA
function calculateVolumeMA(candles, period = 20) {
  if (candles.length < period) return new Array(candles.length).fill(0);
  const vma = new Array(candles.length).fill(0);
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += parseFloat(candles[i].volume || 0);
  }
  vma[period - 1] = sum / period;
  for (let i = period; i < candles.length; i++) {
    vma[i] = (vma[i - 1] * (period - 1) + parseFloat(candles[i].volume || 0)) / period;
  }
  return vma;
}

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

  // 全域策略選擇狀態
  if (window.activeStrategy === undefined) {
    window.activeStrategy = 'none';
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

  // 繪製動態下行趨勢線 (亮粉紅色實線)
  const trendlineSeries = mainChart.addSeries(LightweightCharts.LineSeries, {
    color: '#ec4899',
    lineWidth: 2.5,
    lineStyle: 0,
    title: '下行趨勢線',
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

    // 同步外部 Select 狀態
    const strategySelect = document.getElementById('strategy-select');
    if (strategySelect) {
      strategySelect.value = window.activeStrategy;
    }

    // 清除任何先前殘留的 markers
    LightweightCharts.createSeriesMarkers(candleSeries, []);

    // ---- 策略 A: Super-Trend 策略 ----
    if (window.activeStrategy === 'supertrend') {
      trendlineSeries.setData([]);
      
      const supertrendData = calculateSupertrend(formattedCandles, 10, 3);

      function runSupertrendBacktest(candles, stData) {
        let equity = 1.0;
        let position = null;
        let trades = [];
        let equityHistory = [1.0];

        for (let i = 1; i < stData.length; i++) {
          const prev = stData[i - 1];
          const curr = stData[i];
          const candle = candles.find(c => c.time === curr.time);
          if (!candle) continue;
          const price = parseFloat(candle.close);

          if (prev.trend === -1 && curr.trend === 1) {
            if (position === null) {
              position = { buyPrice: price, time: curr.time };
            }
          } else if (prev.trend === 1 && curr.trend === -1) {
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

        let maxDrawdown = 0;
        let peak = 0;
        for (const eq of equityHistory) {
          if (eq > peak) peak = eq;
          const dd = peak > 0 ? (peak - eq) / peak : 0;
          if (dd > maxDrawdown) maxDrawdown = dd;
        }

        return {
          totalTrades: trades.length,
          totalProfitPct: (equity - 1.0) * 100,
          mddPct: maxDrawdown * 100
        };
      }

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

      const segments = [];
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
        const segCloseData = [];
        let segStMin = Infinity;
        let segStMax = -Infinity;
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

      if (buyMarkers.length > 0) {
        LightweightCharts.createSeriesMarkers(supertrendUpSeries, buyMarkers);
      }
      if (sellMarkers.length > 0) {
        LightweightCharts.createSeriesMarkers(supertrendDnSeries, sellMarkers);
      }
    }
    // ---- 策略 B: 下行趨勢線突破策略 ----
    else if (window.activeStrategy === 'trendline') {
      supertrendUpSeries.setData([]);
      supertrendDnSeries.setData([]);

      function runTrendlineBacktest(candles) {
        let equity = 1.0;
        let position = null;
        let trades = [];
        let equityHistory = [1.0];
        const ma20 = calculateSMA(candles, 20);
        const ma60 = calculateSMA(candles, 60);
        const vma = calculateVolumeMA(candles, 20);

        for (let t = 20; t < candles.length; t++) {
          const curr = candles[t];
          const price = parseFloat(curr.close);
          const vol = parseFloat(curr.volume || 0);

          const m20Obj = ma20.find(m => m.time === curr.time);
          const m60Obj = ma60.find(m => m.time === curr.time);
          if (!m20Obj || !m60Obj) continue;
          const m20 = m20Obj.value;
          const m60 = m60Obj.value;
          const vmaVal = vma[t];

          const tl = calculateTrendlineAt(candles, t);

          if (position === null) {
            if (tl && tl.value !== null) {
              const isBreak = price > tl.value && parseFloat(candles[t - 1].close) <= tl.prevValue;
              const isVolLarge = vol > vmaVal * 1.5;
              const isBullishMA = m20 > m60;

              if (isBreak && isVolLarge && isBullishMA) {
                position = { buyPrice: price, time: curr.time };
              }
            }
          } else {
            // 賣出訊號：收盤跌破 20MA
            if (price < m20) {
              const profitPct = (price - position.buyPrice) / position.buyPrice;
              equity = equity * (1 + profitPct);
              trades.push({
                buyPrice: position.buyPrice,
                sellPrice: price,
                profitPct: profitPct,
                buyTime: position.time,
                sellTime: curr.time
              });
              equityHistory.push(equity);
              position = null;
            }
          }
        }

        if (position !== null && candles.length > 0) {
          const lastPrice = parseFloat(candles[candles.length - 1].close);
          const profitPct = (lastPrice - position.buyPrice) / position.buyPrice;
          equity = equity * (1 + profitPct);
          trades.push({
            buyPrice: position.buyPrice,
            sellPrice: lastPrice,
            profitPct: profitPct,
            buyTime: position.time,
            sellTime: candles[candles.length - 1].time,
            unrealized: true
          });
          equityHistory.push(equity);
        }

        let maxDrawdown = 0;
        let peak = 0;
        for (const eq of equityHistory) {
          if (eq > peak) peak = eq;
          const dd = peak > 0 ? (peak - eq) / peak : 0;
          if (dd > maxDrawdown) maxDrawdown = dd;
        }

        return {
          totalTrades: trades.length,
          totalProfitPct: (equity - 1.0) * 100,
          mddPct: maxDrawdown * 100,
          trades
        };
      }

      const backtestResult = runTrendlineBacktest(formattedCandles);
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

      // 1. 繪製最新一天的動態下行趨勢線
      const tl = calculateTrendlineAt(formattedCandles, formattedCandles.length - 1);
      if (tl && tl.pt1 && tl.pt2) {
        const tlData = [];
        for (let i = tl.pt1.index; i < formattedCandles.length; i++) {
          const val = tl.pt2.high + tl.slope * (i - tl.pt2.index);
          tlData.push({ time: formattedCandles[i].time, value: val });
        }
        trendlineSeries.setData(tlData);
      } else {
        trendlineSeries.setData([]);
      }

      // 2. 標註買賣訊號點到 K 線主圖上
      const btMarkers = [];
      backtestResult.trades.forEach(t => {
        if (t.buyTime) {
          btMarkers.push({
            time: t.buyTime,
            position: 'belowBar',
            color: '#ec4899',
            shape: 'arrowUp',
            text: ' [ BUY ] ',
            size: 2.4
          });
        }
        if (t.sellTime && !t.unrealized) {
          btMarkers.push({
            time: t.sellTime,
            position: 'aboveBar',
            color: '#ef4444',
            shape: 'arrowDown',
            text: ' [ SELL ] ',
            size: 2.4
          });
        }
      });

      if (btMarkers.length > 0) {
        btMarkers.sort((a, b) => (a.time < b.time ? -1 : 1));
        LightweightCharts.createSeriesMarkers(candleSeries, btMarkers);
      }
    }
    // ---- 無策略 ----
    else {
      const summaryEl = document.getElementById('backtest-summary');
      if (summaryEl) {
        summaryEl.style.display = 'none';
      }
      supertrendUpSeries.setData([]);
      supertrendDnSeries.setData([]);
      trendlineSeries.setData([]);
    }

    mainChart.timeScale().fitContent();
    if (rsiChart) rsiChart.timeScale().fitContent();
    console.log(`[LWC] ${containerId}: ${klineData.length} candles rendered with Strategy [${window.activeStrategy}]`);
  } catch (err) {
    console.error('[LWC Error]', err);
    container.innerHTML = `<div style="color:var(--danger);padding:20px;">LWC Render Error: ${err.message}</div>`;
  }

  return mainChart;
}

// 動態圖層策略切換函式
window.changeStrategyLayer = function(strategyName) {
  window.activeStrategy = strategyName;
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

// ---- 🎯 趨勢突破選股動態即時掃描功能 ----
window.openTrendlineBreakoutModal = async function() {
  const matchedStocks = [];
  const notFoundStocks = [];
  let csvStocks = [];

  // 1. 讀取並解析本地的「股票分析清單.csv」
  try {
    const response = await fetch('股票分析清單.csv');
    if (!response.ok) throw new Error(`HTTP 錯誤 ${response.status}`);
    const text = await response.text();
    const lines = text.split('\n');
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = line.split(',');
      if (cols.length >= 3) {
        const rawCode = cols[1].trim();
        const rawName = cols[2].trim();
        if (rawCode && rawCode !== '股票代碼') {
          // 智慧補零邏輯
          let formattedCode = rawCode;
          if (/^\d+$/.test(rawCode)) {
            const val = parseInt(rawCode, 10);
            if (val < 100) {
              formattedCode = String(val).padStart(4, '0');
            } else if (val < 1000) {
              formattedCode = '00' + val;
            }
          }
          csvStocks.push({ code: formattedCode, name: rawName });
        }
      }
    }
  } catch (err) {
    console.error("無法讀取股票分析清單.csv:", err);
    alert(`無法讀取股票分析清單.csv，將使用系統預設監控清單。\n錯誤訊息: ${err.message}`);
    // 降級 fallback
    csvStocks = mockStocks.slice(0, 40).map(s => ({ code: s.id, name: s.name }));
  }

  // 2. 針對 CSV 的股票在已載入的 mockStocks 內查找 K 線並做分析
  csvStocks.forEach(csvStock => {
    // 主查找：以 CSV 解析出的代碼直接比對
    let s = mockStocks.find(item => item.id === csvStock.code);

    // 回退查找：若找不到，嘗試補零至 6 碼 (解決 Excel 前導零丟失：9816 → 009816)
    if (!s && /^\d+$/.test(csvStock.code) && csvStock.code.length < 6) {
      const padded = csvStock.code.padStart(6, '0');
      s = mockStocks.find(item => item.id === padded);
      if (s) csvStock.code = padded; // 同步修正代碼以便後續顯示正確
    }

    if (!s || !s.kline || s.kline.length < 20) {
      notFoundStocks.push(csvStock);
      return;
    }
    
    // 取得日K candles
    const candles = s.kline.map(d => ({
      time: d.date,
      open: parseFloat(d.open),
      high: parseFloat(d.high),
      low: parseFloat(d.low),
      close: parseFloat(d.close),
      volume: parseFloat(d.volume || 0)
    }));

    const t = candles.length - 1;
    const curr = candles[t];
    const price = curr.close;
    const vol = curr.volume;

    const ma20 = calculateSMA(candles, 20);
    const ma60 = calculateSMA(candles, 60);
    const vma = calculateVolumeMA(candles, 20);

    const m20Obj = ma20.find(m => m.time === curr.time);
    const m60Obj = ma60.find(m => m.time === curr.time);
    if (!m20Obj || !m60Obj) return;
    const m20 = m20Obj.value;
    const m60 = m60Obj.value;
    const vmaVal = vma[t];

    const tl = calculateTrendlineAt(candles, t);

    if (tl && tl.value !== null) {
      const isBreak = price > tl.value && parseFloat(candles[t - 1].close) <= tl.prevValue;
      const isVolLarge = vol > vmaVal * 1.5;
      const isBullishMA = m20 > m60;

      if (isBreak && isVolLarge && isBullishMA) {
        matchedStocks.push({
          id: s.id,
          name: s.name,
          price: price,
          change: s.change,
          volRatio: (vol / vmaVal).toFixed(2)
        });
      }
    }
  });

  // 渲染彈跳視窗
  const box = document.getElementById('modalContent');
  if (!box) return;

  // 取得資料庫最新更新時間
  const dataTime = (typeof marketData !== 'undefined' && marketData.lastUpdate) 
    ? marketData.lastUpdate.replace(/-/g, '/') 
    : '未明';

  let listHTML = '';
  if (matchedStocks.length === 0) {
    listHTML = `
      <div style="text-align:center; padding: 30px 10px; color: var(--text-muted);">
        <div style="font-size: 40px; margin-bottom: 12px;">🔍</div>
        <p style="font-size: 14px; font-weight: 500;">目前暫無標的符合「下行趨勢線突破」策略條件。</p>
        <p style="font-size: 12px; margin-top: 6px; color: var(--text-muted);">共掃描了 CSV 清單內 ${csvStocks.length - notFoundStocks.length} 檔有 K 線數據之股票。</p>
      </div>
    `;
  } else {
    listHTML = matchedStocks.map(s => `
      <div class="dash-wl-row" style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:rgba(255,255,255,0.03); border-radius:6px; margin-bottom:8px; border:1px solid rgba(255,255,255,0.05); transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.06)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'">
        <div style="display:flex; align-items:center; gap:8px;">
          <strong style="color:white; font-size:14px;">${s.id}</strong>
          <span style="color:var(--text-muted); font-size:14px;">${s.name}</span>
        </div>
        <div style="display:flex; align-items:center; gap:16px;">
          <span style="font-size:14px; color:var(--text-main); font-weight:600;">$${s.price}</span>
          <span class="${parseFloat(s.change) >= 0 ? 'text-up' : 'text-down'}" style="font-size:12px; font-weight:700;">${s.change >= 0 ? '+' : ''}${s.change}%</span>
          <span class="badge success" style="font-size:11px; padding:2px 6px;">量比: ${s.volRatio}x</span>
          <button class="btn-primary" style="padding: 2px 10px; font-size:12px; height: 26px; font-weight: 500;" onclick="closeModal(); handleTrendlineJump('${s.id}')">
            即刻回測 →
          </button>
        </div>
      </div>
    `).join('');
  }

  // 如果有 CSV 中但本系統暫無 K 線資料的股票，以精巧小提示列在視窗底部
  let notFoundHTML = '';
  if (notFoundStocks.length > 0) {
    notFoundHTML = `
      <div style="margin-top: 12px; padding: 6px 12px; background: rgba(239, 68, 68, 0.06); border: 1px solid rgba(239, 68, 68, 0.15); border-radius: 6px; font-size: 11px; color: var(--text-muted); max-height: 70px; overflow-y: auto;">
        ⚠️ 清單內有 <strong>${notFoundStocks.length}</strong> 檔個股系統暫無 K 線資料，請至篩選器更新以進行分析：
        ${notFoundStocks.map(ns => `${ns.code} ${ns.name}`).join(', ')}
      </div>
    `;
  }

  box.innerHTML = `
    <div style="margin-bottom:20px;">
      <h2 style="color: var(--primary); margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
        <span>🎯 下行趨勢線突破選股</span>
      </h2>
      
      <!-- 交代資料接回來的時間，防止價格太舊 -->
      <div style="display:flex; align-items:center; gap:6px; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.25); color: var(--warning); padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; margin-bottom: 14px;">
        <span>⏳</span>
        <span>資料接回時間：${dataTime} (防範部分價格資料過舊)</span>
      </div>

      <p style="color:var(--text-muted); font-size:12px; margin-bottom: 12px; line-height: 1.5;">
        依據條件篩選：過去20日顯著高點連線突破 + 爆量達1.5倍均量 + MA20 > MA60 多頭排列。本次共掃描 <strong>'股票分析清單.csv'</strong> 內 <strong>${csvStocks.length}</strong> 檔股票。
      </p>
      <hr style="border: 0; border-top: 1px solid var(--border-color); margin-bottom: 12px;">
      
      <div style="max-height: 240px; overflow-y: auto; padding-right: 4px;">
        ${listHTML}
      </div>

      ${notFoundHTML}

      <div style="text-align: center; margin-top:20px;">
        <button class="btn-secondary" onclick="closeModal()" style="padding: 6px 20px; font-size: 14px;">關閉</button>
      </div>
    </div>
  `;

  document.getElementById('stockModal').classList.add('active');
};

// 一鍵跳轉並自動切換至下行趨勢線圖層策略
window.handleTrendlineJump = function(symbolId) {
  const stock = mockStocks.find(s => s.id === symbolId);
  if (stock) {
    window.activeStrategy = 'trendline';
    switchView('chart');
    setTimeout(() => loadTVChart(stock), 300);
  }
};

