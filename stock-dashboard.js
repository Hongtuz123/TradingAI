// =============================================
// TradingView Widget + 個股戰情板邏輯
// =============================================
let currentChartSymbol = null;
let currentLWChart = null;
let currentLWDashChart = null;

// 全域同步圖層疊加狀態物件 ( ma5, supertrend, srLines 預設開啟 )
if (window.chartLayers === undefined) {
  window.chartLayers = {
    ma5: true,
    supertrend: false,
    srLines: true,
    strategySupertrend: false,
    strategyTrendline: false,
    subIndicator: 'rsi'
  };
}

// 橋接原有的單選全域變數，確保相容性
Object.defineProperty(window, 'activeStrategy', {
  get() {
    if (window.chartLayers.strategySupertrend) return 'supertrend';
    if (window.chartLayers.strategyTrendline) return 'trendline';
    return 'none';
  },
  set(val) {
    window.chartLayers.strategySupertrend = (val === 'supertrend');
    window.chartLayers.strategyTrendline = (val === 'trendline');
  },
  configurable: true
});

Object.defineProperty(window, 'activeIndicator', {
  get() {
    return window.chartLayers.subIndicator;
  },
  set(val) {
    window.chartLayers.subIndicator = val;
  },
  configurable: true
});

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

  // 限制最近的確認點不能太遙遠，確保具有即時參考性 (在40天內)
  if (t - pt2.index > 40) return null;

  const slope = (pt2.high - pt1.high) / (pt2.index - pt1.index);
  const valAtT = pt2.high + slope * (t - pt2.index);
  const valAtPrev = pt2.high + slope * (t - 1 - pt2.index);
  return { value: valAtT, prevValue: valAtPrev, pt1, pt2, slope };
}

// 計算成交量的 20MA（標準滑動視窗 SMA，非 EMA）
function calculateVolumeMA(candles, period = 20) {
  if (candles.length < period) return new Array(candles.length).fill(0);
  const vma = new Array(candles.length).fill(0);
  // 使用真正的滑動視窗 SMA：每次加入新值、移除最舊值
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += parseFloat(candles[i].volume || 0);
  }
  vma[period - 1] = sum / period;
  for (let i = period; i < candles.length; i++) {
    sum += parseFloat(candles[i].volume || 0);
    sum -= parseFloat(candles[i - period].volume || 0);
    vma[i] = sum / period;
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
  if (!data || data.length === 0) return [];
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

function calculateEMA(data, period) {
  const ema = [];
  if (data.length === 0) return ema;
  const k = 2 / (period + 1);
  let emaVal = data[0].close;
  ema.push({ time: data[0].time, value: emaVal });
  for (let i = 1; i < data.length; i++) {
    emaVal = data[i].close * k + emaVal * (1 - k);
    ema.push({ time: data[i].time, value: emaVal });
  }
  return ema;
}

function calculateMACD(data, shortPeriod = 12, longPeriod = 26, signalPeriod = 9) {
  if (!data || data.length === 0) return { macdLine: [], signalLine: [], histogram: [] };
  const shortEma = calculateEMA(data, shortPeriod);
  const longEma = calculateEMA(data, longPeriod);
  const macdLine = [];
  
  for (let i = 0; i < data.length; i++) {
    const sVal = shortEma[i] ? shortEma[i].value : 0;
    const lVal = longEma[i] ? longEma[i].value : 0;
    macdLine.push({ time: data[i].time, value: sVal - lVal });
  }

  // 計算 Signal Line (DIF 的 9 EMA)
  const signalLine = [];
  const k = 2 / (signalPeriod + 1);
  let sigVal = macdLine[0] ? macdLine[0].value : 0;
  signalLine.push({ time: data[0].time, value: sigVal });
  for (let i = 1; i < macdLine.length; i++) {
    sigVal = macdLine[i].value * k + sigVal * (1 - k);
    signalLine.push({ time: macdLine[i].time, value: sigVal });
  }

  const histogram = [];
  for (let i = 0; i < data.length; i++) {
    const mVal = macdLine[i].value;
    const sVal = signalLine[i].value;
    histogram.push({ time: data[i].time, value: mVal - sVal });
  }

  return { macdLine, signalLine, histogram };
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

// ---- 離線模擬分K高亮警告 Banner ----
function showMockWarning(show, timeframe = '') {
  let warnEl = document.getElementById('mock-timeframe-warning');
  if (!show) {
    if (warnEl) warnEl.remove();
    return;
  }
  if (!warnEl) {
    warnEl = document.createElement('div');
    warnEl.id = 'mock-timeframe-warning';
    warnEl.style.cssText = 'position:absolute; top:12px; left:50%; transform:translateX(-50%); z-index:100; background:rgba(239, 68, 68, 0.9); color:white; padding:8px 16px; border-radius:6px; font-size:12px; font-weight:600; box-shadow:0 4px 12px rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.2); pointer-events:none; display:flex; align-items:center; gap:8px;';
    const container = document.getElementById('tvChartContainer');
    if (container) {
      container.style.position = 'relative';
      container.appendChild(warnEl);
    }
  }
  
  let friendlyTF = timeframe;
  if (timeframe === '15m') friendlyTF = '15分鐘';
  if (timeframe === '1h') friendlyTF = '1小時';
  if (timeframe === '4h') friendlyTF = '4小時';
  
  warnEl.innerHTML = `⚠️ 偵測到與本地交易伺服器斷線。當前 <strong>${friendlyTF}</strong> 為日K模擬數據，僅供介面展示！`;
}

// ---- Lightweight Charts 渲染函式 ----
function renderLWChart(containerId, klineData, height = 260, resolution = '1D') {
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
      const normalized = dateStr.replace(' ', 'T');
      const parsed = Math.floor(Date.parse(normalized) / 1000);
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

  const maxPrice = formattedCandles.length > 0 ? Math.max(...formattedCandles.map(c => c.high)) : 1000;

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

  let mainChart, rsiChart, mainDiv = null;

  if (isMainChart) {
    container.style.display = 'flex';
    container.style.flexDirection = 'column';

    mainDiv = document.createElement('div');
    container.appendChild(mainDiv);


    if (window.activeIndicator !== 'none') {
      mainDiv.style.cssText = 'flex:3;min-height:0;position:relative;';

      // RSI 面板分隔線（保留 12px 透明空格間隔）
      const separator = document.createElement('div');
      separator.style.cssText = 'height:12px;background:transparent;flex-shrink:0;';
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

      // 同步主圖與 RSI 面板的時間軸 (加上 isSyncing 鎖防止雙向訂閱引發遞迴爆棧)
      let isSyncing = false;
      mainChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (isSyncing) return;
        isSyncing = true;
        if (range) rsiChart.timeScale().setVisibleLogicalRange(range);
        isSyncing = false;
      });
      rsiChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (isSyncing) return;
        isSyncing = true;
        if (range) mainChart.timeScale().setVisibleLogicalRange(range);
        isSyncing = false;
      });
    } else {
      // 無副圖時，主圖佔滿 100%
      mainDiv.style.cssText = 'flex:1;min-height:0;position:relative;';

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
    }
  } else {
    // ==== 內嵌圖表：RSI 疊在主圖上（空間有限）====
    container.style.display = 'block';
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
    title: '',
    crosshairMarkerVisible: false,
    lastValueVisible: false,
    priceLineVisible: false,
  });

  // 全域策略選擇狀態
  if (window.activeStrategy === undefined) {
    window.activeStrategy = 'none';
  }

  // 繪製 Supertrend 上升軌道（綠色實線，帶有下方透明度漸層）
  const supertrendUpSeries = mainChart.addSeries(LightweightCharts.AreaSeries, {
    lineColor: '#22c55e',
    topColor: 'rgba(34, 197, 94, 0.25)',  // 靠近折線處為較深綠色
    bottomColor: 'rgba(34, 197, 94, 0.0)', // 底部為透明
    lineWidth: 2,
    title: '',
    crosshairMarkerVisible: true,
    crosshairMarkerRadius: 4,
    lastValueVisible: false,
    priceLineVisible: false,
  });

  // 繪製 Supertrend 下降軌道（紅色實線，帶有上方透明度漸層）
  const supertrendDnSeries = mainChart.addSeries(LightweightCharts.BaselineSeries, {
    baseValue: { type: 'price', price: maxPrice * 1.05 }, // 動態設定為最高價的 1.05 倍
    bottomLineColor: '#ef4444', // 折線本身為紅色
    bottomFillColor1: 'rgba(239, 68, 68, 0.25)', // 先設為 0.25 測試
    bottomFillColor2: 'rgba(239, 68, 68, 0.25)', // 先設為 0.25 測試
    topLineColor: 'transparent',
    topFillColor1: 'transparent',
    topFillColor2: 'transparent',
    lineWidth: 2,
    title: '',
    crosshairMarkerVisible: true,
    crosshairMarkerRadius: 4,
    lastValueVisible: false,
    priceLineVisible: false,
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

  // 全域副圖指標選擇狀態
  if (window.activeIndicator === undefined) {
    window.activeIndicator = 'rsi'; // 預設 RSI
  }

  // 同步副圖指標下拉選單 UI 狀態
  const indicatorSelect = document.getElementById('indicator-select');
  if (indicatorSelect) {
    indicatorSelect.value = window.activeIndicator;
  }

  // ---- 副圖 Series 根據選擇動態加入 ----
  const subTargetChart = (isMainChart && window.activeIndicator !== 'none') ? rsiChart : mainChart;
  
  // 宣告副圖 Series 用於動態清理與寫入
  let rsiSeries = null;
  let macdLineSeries = null;
  let macdSignalSeries = null;
  let macdHistSeries = null;
  let rsi70Series = null;
  let rsi30Series = null;

  if (window.activeIndicator === 'rsi') {
    // 渲染 RSI 指標
    const rsiSeriesOptions = {
      color: '#eab308',
      lineWidth: 1.5,
      title: 'RSI(14)',
    };
    if (!isMainChart) {
      rsiSeriesOptions.priceScaleId = 'rsi';
    }
    rsiSeries = subTargetChart.addSeries(LightweightCharts.LineSeries, rsiSeriesOptions);
    if (!isMainChart) {
      subTargetChart.priceScale('rsi').applyOptions({
        scaleMargins: { top: 0.7, bottom: 0.15 },
      });
    }

    if (isMainChart && rsiChart) {
      rsi70Series = subTargetChart.addSeries(LightweightCharts.LineSeries, {
        color: 'rgba(239,68,68,0.35)',
        lineWidth: 1,
        lineStyle: 2, // Dashed
        title: '',
        crosshairMarkerVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      rsi30Series = subTargetChart.addSeries(LightweightCharts.LineSeries, {
        color: 'rgba(34,197,94,0.35)',
        lineWidth: 1,
        lineStyle: 2,
        title: '',
        crosshairMarkerVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      const refLineData = formattedCandles.map(d => ({ time: d.time }));
      rsi70Series.setData(refLineData.map(d => ({ time: d.time, value: 70 })));
      rsi30Series.setData(refLineData.map(d => ({ time: d.time, value: 30 })));
    }
  } else if (window.activeIndicator === 'macd') {
    // 渲染 MACD 指標 (Short 12, Long 26, Signal 9)
    const macdOptions = { lineWidth: 1.5, title: 'DIF' };
    const signalOptions = { color: '#3b82f6', lineWidth: 1.5, title: 'MACD' };
    const histOptions = { priceScaleId: 'macdHist', title: 'OSC' };
    
    if (!isMainChart) {
      macdOptions.priceScaleId = 'macd';
      signalOptions.priceScaleId = 'macd';
    }

    macdLineSeries = subTargetChart.addSeries(LightweightCharts.LineSeries, { color: '#ec4899', ...macdOptions });
    macdSignalSeries = subTargetChart.addSeries(LightweightCharts.LineSeries, signalOptions);
    macdHistSeries = subTargetChart.addSeries(LightweightCharts.HistogramSeries, {
      color: '#10b981',
      ...histOptions
    });

    if (!isMainChart) {
      subTargetChart.priceScale('macd').applyOptions({ scaleMargins: { top: 0.7, bottom: 0.15 } });
    }
  }

  try {
    candleSeries.setData(formattedCandles);
    volumeSeries.setData(formattedVolume);
    if (window.chartLayers.ma5) {
      smaSeries.setData(calculateSMA(formattedCandles, 5));
    } else {
      smaSeries.setData([]);
    }

    // 動態計算並載入指標數據
    const rsiData = calculateRSI(formattedCandles, 14);
    const macdData = calculateMACD(formattedCandles, 12, 26, 9);

    if (window.activeIndicator === 'rsi') {
      if (rsiSeries) rsiSeries.setData(rsiData);
    } else if (window.activeIndicator === 'macd') {
      if (macdLineSeries) macdLineSeries.setData(macdData.macdLine);
      if (macdSignalSeries) macdSignalSeries.setData(macdData.signalLine);
      
      const histFormatted = macdData.histogram.map(h => ({
        time: h.time,
        value: h.value,
        color: h.value >= 0 ? 'rgba(239, 68, 68, 0.5)' : 'rgba(34, 197, 94, 0.5)' // 紅柱與綠柱
      }));
      if (macdHistSeries) macdHistSeries.setData(histFormatted);
    }

    // 同步外部 Select 狀態
    const strategySelect = document.getElementById('strategy-select');
    if (strategySelect) {
      strategySelect.value = window.activeStrategy;
    }

    // 清除任何先前殘留的 markers
    LightweightCharts.createSeriesMarkers(candleSeries, []);

    // ── 🎯 智慧型指標與特殊 K 線標註系統 ──
    const customMarkers = [];
    const candleColors = []; // 用於保存自定義 K 棒著色

    if (window.activeIndicator === 'macd') {
      // 1. MACD 金叉 / 死叉 自動標註並著色為白色 K 棒
      const macdLine = macdData.macdLine;
      const sigLine = macdData.signalLine;
      
      for (let i = 1; i < macdLine.length; i++) {
        const prevDiff = macdLine[i - 1].value - sigLine[i - 1].value;
        const currDiff = macdLine[i].value - sigLine[i].value;
        const time = macdLine[i].time;

        if (prevDiff <= 0 && currDiff > 0) {
          // 黃金交叉
          customMarkers.push({
            time: time,
            position: 'belowBar',
            color: '#ef4444', // 紅色金叉
            shape: 'arrowUp',
            text: '金叉',
            size: 2.0
          });
          candleColors.push({ time: time, color: '#ffffff' }); // 塗成白色
        } else if (prevDiff >= 0 && currDiff < 0) {
          // 死亡交叉
          customMarkers.push({
            time: time,
            position: 'aboveBar',
            color: '#10b981', // 綠色死叉
            shape: 'arrowDown',
            text: '死叉',
            size: 2.0
          });
          candleColors.push({ time: time, color: '#ffffff' }); // 塗成白色
        }
      }
    } 
    else if (window.activeIndicator === 'rsi') {
      // 2. RSI 特殊 K 線高機率型態與反轉/延續標註
      // 規則：看漲型態搭配 RSI 位於 30-60 之間視為看漲 (著色白色 K 棒)；看跌搭配 RSI 高於 70 視為看跌 (著色白色 K 棒)
      for (let i = 2; i < formattedCandles.length; i++) {
        const c1 = formattedCandles[i - 2];
        const c2 = formattedCandles[i - 1];
        const c3 = formattedCandles[i];
        const time = c3.time;

        // 取得該根 K 棒的 RSI 值
        const rsiObj = rsiData.find(r => r.time === time);
        if (!rsiObj) continue;
        const rsiVal = rsiObj.value;

        // (A) 早晨之星 / 錘子線 / 看漲吞沒（看漲型態判定）
        const isBullishEngulfing = c3.close > c3.open && c2.close < c2.open && (c3.close >= c2.open) && (c3.open <= c2.close);
        const isHammer = (c3.high - Math.max(c3.open, c3.close)) < (c3.high - c3.low) * 0.1 && (Math.min(c3.open, c3.close) - c3.low) > (c3.high - c3.low) * 0.6;
        const isMorningStar = c1.close < c1.open && Math.abs(c2.close - c2.open) < (c1.open - c1.close) * 0.3 && c3.close > c3.open && c3.close > (c1.open + c1.close) / 2;

        if (isBullishEngulfing || isHammer || isMorningStar) {
          // 看漲條件：極值與超賣區 30-60
          if (rsiVal >= 30 && rsiVal <= 60) {
            customMarkers.push({
              time: time,
              position: 'belowBar',
              color: '#ef4444', // 紅色字
              shape: 'arrowUp',
              text: 'RSI超買(漲)',
              size: 2.0
            });
            candleColors.push({ time: time, color: '#ffffff' }); // 著色為白色 K 棒
          }
        }

        // (B) 黃昏之星 / 流星線 / 看跌吞沒（看跌型態判定）
        const isBearishEngulfing = c3.close < c3.open && c2.close > c2.open && (c3.close <= c2.open) && (c3.open >= c2.close);
        const isShootingStar = (c3.high - Math.max(c3.open, c3.close)) > (c3.high - c3.low) * 0.6 && (Math.min(c3.open, c3.close) - c3.low) < (c3.high - c3.low) * 0.1;
        const isEveningStar = c1.close > c1.open && Math.abs(c2.close - c2.open) < (c1.close - c1.open) * 0.3 && c3.close < c3.open && c3.close < (c1.open + c1.close) / 2;

        if (isBearishEngulfing || isShootingStar || isEveningStar) {
          // 看跌條件：RSI 超過 70
          if (rsiVal >= 70) {
            customMarkers.push({
              time: time,
              position: 'aboveBar',
              color: '#10b981', // 綠色字
              shape: 'arrowDown',
              text: 'RSI超賣(跌)',
              size: 2.0
            });
            candleColors.push({ time: time, color: '#ffffff' }); // 著色為白色 K 棒
          }
        }
      }
    }

    // 將所有計算出來的黃金交叉/特殊型態 marker 加上
    if (customMarkers.length > 0) {
      LightweightCharts.createSeriesMarkers(candleSeries, customMarkers);
    }

    // 動態套用 K 棒的著色 (若有白色 K 棒)
    if (candleColors.length > 0) {
      candleSeries.setData(formattedCandles.map(c => {
        const colObj = candleColors.find(cc => cc.time === c.time);
        if (colObj) {
          return {
            ...c,
            color: colObj.color,
            borderColor: colObj.color,
            wickColor: colObj.color
          };
        }
        // 未自訂著色的 K 棒，手動補回漲紅跌綠的預設顏色，防止被 Lightweight Charts 渲染成黑色隱形
        const isUp = c.close >= c.open;
        const defaultColor = isUp ? '#ef4444' : '#22c55e';
        return {
          ...c,
          color: defaultColor,
          borderColor: defaultColor,
          wickColor: defaultColor
        };
      }));
    }


    // ─── 支撐阻力線 (日線/4H/1H) 計算與繪製 ───
    const allTimes = formattedCandles.map(c => c.time);

    // 合成高時框與計算 S&R 函數
    function drawSRLinesForResolution(targetRes, multiplier, pivotLen) {
      if (!multiplier || isNaN(multiplier) || multiplier <= 0 || formattedCandles.length === 0) {
        return;
      }

      // 1. Resample K線
      const resampled = [];
      for (let i = 0; i < formattedCandles.length; i += multiplier) {
        const slice = formattedCandles.slice(i, Math.min(i + multiplier, formattedCandles.length));
        if (slice.length === 0) continue;
        resampled.push({
          time: slice[0].time, // 使用該區段第一根K線的時間
          open: slice[0].open,
          high: Math.max(...slice.map(s => s.high)),
          low: Math.min(...slice.map(s => s.low)),
          close: slice[slice.length - 1].close
        });
      }

      // 2. 計算 Pivot S&R
      const supports = [];
      const resistances = [];
      if (resampled.length >= pivotLen * 2 + 1) {
        for (let i = pivotLen; i < resampled.length - pivotLen; i++) {
          const curr = resampled[i];
          
          // Low Pivot (支撐)
          let isLow = true;
          for (let j = i - pivotLen; j <= i + pivotLen; j++) {
            if (resampled[j].low < curr.low) { isLow = false; break; }
          }
          if (isLow) supports.push(curr);

          // High Pivot (壓力)
          let isHigh = true;
          for (let j = i - pivotLen; j <= i + pivotLen; j++) {
            if (resampled[j].high > curr.high) { isHigh = false; break; }
          }
          if (isHigh) resistances.push(curr);
        }
      }

      // 3. 檢查失效 (篩選有效的線)
      const activeSups = [];
      const activeReses = [];

      // 計算 ATR 作為過濾太近的線的基準 (太近就不重複畫)
      let atr = 0;
      if (formattedCandles.length > 20) {
        let sum = 0;
        for (let i = formattedCandles.length - 20; i < formattedCandles.length; i++) {
          sum += (formattedCandles[i].high - formattedCandles[i].low);
        }
        atr = sum / 20;
      }
      const tooClosePrice = atr * 0.15;

      // 處理支撐
      for (const sup of supports) {
        let endTime = formattedCandles[formattedCandles.length - 1].time;
        let isValid = true;
        const startIdx = formattedCandles.findIndex(c => c.time === sup.time);
        if (startIdx !== -1) {
          for (let j = startIdx + 1; j < formattedCandles.length; j++) {
            if (formattedCandles[j].close < sup.low) {
              endTime = formattedCandles[j].time;
              isValid = false;
              break;
            }
          }
        }
        
        // 避開太近的重複價格
        const isDuplicate = activeSups.some(s => Math.abs(s.price - sup.low) < tooClosePrice && s.isValid === isValid);
        if (!isDuplicate) {
          activeSups.push({ price: sup.low, startTime: sup.time, endTime, isValid });
        }
      }

      // 處理阻力
      for (const res of resistances) {
        let endTime = formattedCandles[formattedCandles.length - 1].time;
        let isValid = true;
        const startIdx = formattedCandles.findIndex(c => c.time === res.time);
        if (startIdx !== -1) {
          for (let j = startIdx + 1; j < formattedCandles.length; j++) {
            if (formattedCandles[j].close > res.high) {
              endTime = formattedCandles[j].time;
              isValid = false;
              break;
            }
          }
        }
        const isDuplicate = activeReses.some(r => Math.abs(r.price - res.high) < tooClosePrice && r.isValid === isValid);
        if (!isDuplicate) {
          activeReses.push({ price: res.high, startTime: res.time, endTime, isValid });
        }
      }

      // 4. 限制最大繪製數量 (保留最近的有效線)
      const maxLines = 8;
      const sortedSups = activeSups.filter(s => s.isValid).slice(-maxLines);
      const sortedReses = activeReses.filter(r => r.isValid).slice(-maxLines);

      // 5. 動態為每一條線段創建單獨的 LineSeries (避免使用 value: null 的 bug)
      sortedSups.forEach(l => {
        const width = targetRes === '1D' ? 3 : targetRes === '4h' ? 2 : 1.5;
        const style = targetRes === '1h' ? 2 : 0;
        const lineSer = mainChart.addSeries(LightweightCharts.LineSeries, {
          color: 'rgba(16, 185, 129, 0.3)', // 支撐綠 (透明度30%)
          lineWidth: width,
          lineStyle: style,
          title: targetRes === '1D' ? '日線支撐' : targetRes === '4h' ? '4H支撐' : '1H支撐',
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        });
        lineSer.setData([
          { time: l.startTime, value: l.price },
          { time: l.endTime, value: l.price }
        ]);
        highlighterSeriesList.push(lineSer);
      });

      sortedReses.forEach(l => {
        const width = targetRes === '1D' ? 3 : targetRes === '4h' ? 2 : 1.5;
        const style = targetRes === '1h' ? 2 : 0;
        const lineSer = mainChart.addSeries(LightweightCharts.LineSeries, {
          color: 'rgba(239, 68, 68, 0.3)', // 阻力紅 (透明度30%)
          lineWidth: width,
          lineStyle: style,
          title: targetRes === '1D' ? '日線阻力' : targetRes === '4h' ? '4H阻力' : '1H阻力',
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        });
        lineSer.setData([
          { time: l.startTime, value: l.price },
          { time: l.endTime, value: l.price }
        ]);
        highlighterSeriesList.push(lineSer);
      });
    }

    // 依據當前選定的 timeframe (resolution) 來分流計算
    const resStr = (typeof resolution === 'string') ? resolution : '1D';
    let dayMult = 0, fourHMult = 0, oneHMult = 0;
    let dayPivot = 15, fourHPivot = 15, oneHPivot = 15;

    if (resStr === '15m') {
      dayMult = 96;   dayPivot = 5;  // 15m * 96 = 24H (1D)
      fourHMult = 16; fourHPivot = 8; // 15m * 16 = 4H
      oneHMult = 4;   oneHPivot = 15; // 15m * 4 = 1H
    } else if (resStr === '1h') {
      dayMult = 24;   dayPivot = 6;  // 1H * 24 = 24H (1D)
      fourHMult = 4;  fourHPivot = 12; // 1H * 4 = 4H
      oneHMult = 1;   oneHPivot = 15;
    } else if (resStr === '4h') {
      dayMult = 6;    dayPivot = 10; // 4H * 6 = 24H (1D)
      fourHMult = 1;  fourHPivot = 15;
      oneHMult = 0; // 4H 時框下不計算 1H 支撐壓力 (低於當前時框不予顯示)
    } else { // 預設 '1D'
      dayMult = 1;    dayPivot = 15;
      fourHMult = 0;
      oneHMult = 0;
    }

    // 繪製各個時框
    if (window.chartLayers.srLines) {
      drawSRLinesForResolution('1D', dayMult, dayPivot);
      drawSRLinesForResolution('4h', fourHMult, fourHPivot);
      drawSRLinesForResolution('1h', oneHMult, oneHPivot);
    }

    // 計算 Supertrend 基礎數據 (以供常駐指標與回測策略共用)
    const supertrendData = calculateSupertrend(formattedCandles, 10, 3);

    // ==== 常駐 Supertrend 指標線繪製 ====
    if (window.chartLayers.supertrend && !window.chartLayers.strategySupertrend) {
      
      // 1. 拆分趨勢段 (Segments)
      const stSegments = [];
      let segStart = -1;
      let segTrend = null;
      for (let i = 0; i < supertrendData.length; i++) {
        const curr = supertrendData[i];
        if (curr.value === null) continue;
        if (curr.trend !== segTrend) {
          if (segTrend !== null && segStart >= 0) {
            stSegments.push({ trend: segTrend, startIdx: segStart, endIdx: i - 1 });
          }
          segTrend = curr.trend;
          segStart = i;
        }
      }
      if (segTrend !== null && segStart >= 0) {
        stSegments.push({ trend: segTrend, startIdx: segStart, endIdx: supertrendData.length - 1 });
      }

      // 2. 依據趨勢段動態繪製對應之 Series
      stSegments.forEach(seg => {
        const segData = [];
        let segMax = -Infinity;
        for (let i = seg.startIdx; i <= seg.endIdx; i++) {
          segData.push({ time: supertrendData[i].time, value: supertrendData[i].value });
          segMax = Math.max(segMax, supertrendData[i].value);
        }

        if (seg.trend === 1) {
          // 多頭上升軌道：AreaSeries 往下延伸漸層
          const upSeries = mainChart.addSeries(LightweightCharts.AreaSeries, {
            lineColor: '#22c55e',
            topColor: 'rgba(34, 197, 94, 0.22)',
            bottomColor: 'rgba(34, 197, 94, 0.0)',
            lineWidth: 2,
            title: '',
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 4,
            lastValueVisible: false,
            priceLineVisible: false,
          });
          upSeries.setData(segData);
          highlighterSeriesList.push(upSeries);
        } else {
          // 空頭下降軌道：BaselineSeries 往上延伸漸層 (動態 baseValue 緊貼最高價)
          const dnSeries = mainChart.addSeries(LightweightCharts.BaselineSeries, {
            baseValue: { type: 'price', price: segMax * 1.04 },
            bottomLineColor: '#ef4444',
            bottomFillColor1: 'rgba(239, 68, 68, 0.0)',
            bottomFillColor2: 'rgba(239, 68, 68, 0.22)',
            topLineColor: 'transparent',
            topFillColor1: 'transparent',
            topFillColor2: 'transparent',
            lineWidth: 2,
            title: '',
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 4,
            lastValueVisible: false,
            priceLineVisible: false,
          });
          dnSeries.setData(segData);
          highlighterSeriesList.push(dnSeries);
        }
      });
    }

    // ---- 策略 A: Super-Trend 策略 ----
    if (window.activeStrategy === 'supertrend') {
      trendlineSeries.setData([]);

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
        const segLineData = [];
        let segStMin = Infinity;
        let segStMax = -Infinity;
        for (let i = seg.startIdx; i <= seg.endIdx; i++) {
          if (supertrendData[i].value === null) continue;
          
          segLineData.push({ time: supertrendData[i].time, value: supertrendData[i].value });

          const candle = formattedCandles.find(c => c.time === supertrendData[i].time);
          if (candle) {
            segCloseData.push({ time: candle.time, value: candle.close });
            segStMin = Math.min(segStMin, supertrendData[i].value);
            segStMax = Math.max(segStMax, supertrendData[i].value);
          }
        }

        if (segCloseData.length === 0) continue;

        // 繪製背景填充 (透明度調低，顏色更飽滿)
        if (seg.trend === 1) {
          const hlSeries = mainChart.addSeries(LightweightCharts.BaselineSeries, {
            baseValue: { type: 'price', price: segStMin },
            topLineColor: 'transparent',
            topFillColor1: 'rgba(34, 197, 94, 0.35)',
            topFillColor2: 'rgba(34, 197, 94, 0.08)',
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

          // 繪製該段綠色軌道實線 (獨立 Series，轉換趨勢時不連起來)
          const lineSeries = mainChart.addSeries(LightweightCharts.LineSeries, {
            color: '#22c55e',
            lineWidth: 2,
            lineStyle: 0,
            title: '',
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 4,
            lastValueVisible: false,
            priceLineVisible: false,
          });
          lineSeries.setData(segLineData);
          highlighterSeriesList.push(lineSeries);
        } else {
          const hlSeries = mainChart.addSeries(LightweightCharts.BaselineSeries, {
            baseValue: { type: 'price', price: segStMax },
            topLineColor: 'transparent',
            topFillColor1: 'transparent',
            topFillColor2: 'transparent',
            bottomLineColor: 'transparent',
            bottomFillColor1: 'rgba(239, 68, 68, 0.28)',
            bottomFillColor2: 'rgba(239, 68, 68, 0.45)',
            lineWidth: 0,
            title: '',
            crosshairMarkerVisible: false,
            priceLineVisible: false,
            lastValueVisible: false,
          });
          hlSeries.setData(segCloseData);
          highlighterSeriesList.push(hlSeries);

          // 繪製該段紅色軌道實線 (獨立 Series，轉換趨勢時不連起來)
          const lineSeries = mainChart.addSeries(LightweightCharts.LineSeries, {
            color: '#ef4444',
            lineWidth: 2,
            lineStyle: 0,
            title: '',
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 4,
            lastValueVisible: false,
            priceLineVisible: false,
          });
          lineSeries.setData(segLineData);
          highlighterSeriesList.push(lineSeries);
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

      // 清空原始整條連線的 Series，改用分段 Series
      supertrendUpSeries.setData([]);
      supertrendDnSeries.setData([]);

      // 買賣箭頭標記在主 K 線圖（candleSeries）上，更加美觀精準
      const allMarkers = [...buyMarkers, ...sellMarkers].sort((a, b) => (a.time < b.time ? -1 : 1));
      if (allMarkers.length > 0) {
        LightweightCharts.createSeriesMarkers(candleSeries, allMarkers);
      }
    }
    // ---- 策略 B: 下行趨勢線突破策略 ----
    else if (window.activeStrategy === 'trendline') {

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
      trendlineSeries.setData([]);
    }

    mainChart.timeScale().fitContent();
    if (rsiChart) rsiChart.timeScale().fitContent();
    console.log(`[LWC] ${containerId}: ${klineData.length} candles rendered with Strategy [${window.activeStrategy}]`);
    
    if (isMainChart && mainDiv && typeof window.setupDrawingEvents === 'function') {
      window.setupDrawingEvents(mainDiv, mainChart, candleSeries);
    }

  } catch (err) {
    console.error('[LWC Error]', err);
    container.innerHTML = `<div style="color:var(--danger);padding:20px;">LWC Render Error: ${err.message}</div>`;
  }

  return mainChart;
}

// 多圖層控制切換
window.toggleChartLayer = function(layerName) {
  if (layerName === 'strategySupertrend') {
    window.chartLayers.strategySupertrend = !window.chartLayers.strategySupertrend;
    if (window.chartLayers.strategySupertrend) {
      window.chartLayers.strategyTrendline = false; // 策略互斥
    }
  } else if (layerName === 'strategyTrendline') {
    window.chartLayers.strategyTrendline = !window.chartLayers.strategyTrendline;
    if (window.chartLayers.strategyTrendline) {
      window.chartLayers.strategySupertrend = false; // 策略互斥
    }
  } else {
    window.chartLayers[layerName] = !window.chartLayers[layerName];
  }

  updatePillButtonsUI();

  if (currentChartSymbol) {
    const stock = mockStocks.find(s => s.id === currentChartSymbol);
    if (stock) {
      loadTVChart(stock);
    }
  }
};

// 副圖單選切換
window.selectSubIndicator = function(indicatorName) {
  window.chartLayers.subIndicator = indicatorName;
  updatePillButtonsUI();

  if (currentChartSymbol) {
    const stock = mockStocks.find(s => s.id === currentChartSymbol);
    if (stock) {
      loadTVChart(stock);
    }
  }
};

// 同步 UI 按鈕狀態
function updatePillButtonsUI() {
  const layers = ['ma5', 'supertrend', 'srLines', 'strategySupertrend', 'strategyTrendline'];
  layers.forEach(layer => {
    const el = document.getElementById(`pill-${layer}`);
    if (el) {
      if (window.chartLayers[layer]) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    }
  });

  const subIndicators = ['rsi', 'macd', 'none'];
  subIndicators.forEach(ind => {
    const el = document.getElementById(`pill-sub-${ind}`);
    if (el) {
      if (window.chartLayers.subIndicator === ind) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    }
  });
}

// 相容層：供外部舊程式碼呼叫
window.changeStrategyLayer = function(strategyName) {
  window.activeStrategy = strategyName;
  updatePillButtonsUI();
  if (currentChartSymbol) {
    const stock = mockStocks.find(s => s.id === currentChartSymbol);
    if (stock) loadTVChart(stock);
  }
};
window.changeSubIndicator = function(indicatorName) {
  window.activeIndicator = indicatorName;
  updatePillButtonsUI();
  if (currentChartSymbol) {
    const stock = mockStocks.find(s => s.id === currentChartSymbol);
    if (stock) loadTVChart(stock);
  }
};

let currentKlineData = null;

window.loadTVChart = function(s) {
  updatePillButtonsUI();
  
  // 記錄舊圖表的 visible range (如果是同個 Symbol)
  let lastVisibleRange = null;
  if (currentLWChart && currentChartSymbol === s.id) {
    try {
      lastVisibleRange = currentLWChart.timeScale().getVisibleRange();
    } catch (e) {
      console.warn('Failed to get visible range', e);
    }
  }

  currentChartSymbol = s.id;
  window.currentChartMarket = s.market || 'TWSE';

  // 更新頂部提示列的名稱
  const nameEl = document.querySelector('.chart-name');
  if (nameEl) {
    nameEl.innerHTML = `<span style="color:white;font-size:14px;font-weight:bold;">${s.id} ${s.name}</span> <span style="color:var(--text-muted);font-size:11px;">(${window.currentChartMarket})</span>`;
  }

  const container = document.getElementById('tvChartContainer');
  container.innerHTML = '';

  if (s.kline && s.kline.length > 0) {
    currentKlineData = s.kline;
    const rect = container.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : 800;
    const chartHeight = rect.height > 0 ? rect.height : 500;

    currentLWChart = renderLWChart('tvChartContainer', s.kline, chartHeight, '1D');
    
    // 如果有之前的 range 且為同一個個股，則套用；否則套用預設的 30 日
    setTimeout(() => {
      if (lastVisibleRange && lastVisibleRange.from && lastVisibleRange.to) {
        try {
          currentLWChart.timeScale().setVisibleRange(lastVisibleRange);
        } catch (err) {
          console.warn('Failed to restore visible range', err);
          setTimeframe(30);
        }
      } else {
        setTimeframe(30);
      }
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
      const parseKlineTime = (dateStr) => {
        if (typeof dateStr === 'string' && (dateStr.includes(' ') || dateStr.includes(':'))) {
          const normalized = dateStr.replace(' ', 'T');
          const parsed = Math.floor(Date.parse(normalized) / 1000);
          return isNaN(parsed) ? dateStr : parsed;
        }
        return dateStr;
      };

      timeScale.setVisibleRange({
        from: parseKlineTime(fromData.date),
        to: parseKlineTime(toData.date)
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
  const daysMap    = { '15m':59,   '1h':60,  '4h':180, '1D':250, '1W':365, '1M':730 };
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
      currentLWChart = renderLWChart('tvChartContainer', data.kline, 500, res);
      showMockWarning(false); // 成功拿到真實資料，關閉警告
    } else {
      container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted)">無可用資料</div>';
      showMockWarning(false);
    }
  } catch (err) {
    console.warn("無法取得 API K 線，嘗試進入離線多時框模擬模式：", err.message);
    const stock = mockStocks.find(s => s.id === currentChartSymbol);
    if (stock && stock.kline && stock.kline.length > 0) {
      // 離線/靜態部署模式：依時框動態生成高擬真 K 線數據
      const simulatedKline = generateMockTimeframeData(stock.kline, res);
      currentKlineData = simulatedKline;
      currentLWChart = renderLWChart('tvChartContainer', simulatedKline, 500, res);
      
      // 如果切換的是分K時框，則顯示模擬警告
      if (res === '15m' || res === '1h' || res === '4h') {
        showMockWarning(true, res);
      } else {
        showMockWarning(false);
      }
    } else {
      container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted)">無可用資料 (${err.message})</div>`;
      showMockWarning(false);
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

  // 讀取動態參數（附帶預設值防禦）
  const paramTimeframeVal = document.getElementById('tb_param_timeframe');
  const paramBarsVal = document.getElementById('tb_param_bars');
  const paramVolVal = document.getElementById('tb_param_vol');
  const paramVolNVal = document.getElementById('tb_param_vol_n');
  const paramMaFastVal = document.getElementById('tb_param_ma_fast');
  const paramMaSlowVal = document.getElementById('tb_param_ma_slow');

  const paramTimeframe = paramTimeframeVal ? paramTimeframeVal.value : 'daily';
  const paramBars = paramBarsVal ? parseInt(paramBarsVal.value, 10) : 20;
  const paramVol = paramVolVal ? parseFloat(paramVolVal.value) : 1.5;
  const paramVolN = paramVolNVal ? parseInt(paramVolNVal.value, 10) : 20;
  const paramMaFast = paramMaFastVal ? parseInt(paramMaFastVal.value, 10) : 20;
  const paramMaSlow = paramMaSlowVal ? parseInt(paramMaSlowVal.value, 10) : 60;

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

    if (!s || !s.kline || s.kline.length === 0) {
      notFoundStocks.push(csvStock);
      return;
    }
    
    // 根據選擇的選股時框獲取數據
    let candlesSource = s.kline;
    if (paramTimeframe !== 'daily') {
      candlesSource = generateMockTimeframeData(s.kline, paramTimeframe);
    }

    if (!candlesSource || candlesSource.length < Math.max(paramBars, paramMaSlow, paramVolN)) {
      notFoundStocks.push(csvStock);
      return;
    }
    
    // 取得 candles
    const candles = candlesSource.map(d => ({
      time: d.date || d.time,
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

    const maFastArr = calculateSMA(candles, paramMaFast);
    const maSlowArr = calculateSMA(candles, paramMaSlow);
    const vma = calculateVolumeMA(candles, paramVolN); // 均量以設定的 n 根 K 棒為準

    const mFastObj = maFastArr.find(m => m.time === curr.time);
    const mSlowObj = maSlowArr.find(m => m.time === curr.time);
    if (!mFastObj || !mSlowObj) return;
    const mFast = mFastObj.value;
    const mSlow = mSlowObj.value;
    const vmaVal = vma[t];

    // 動態趨勢線計算，回溯點與確認點時限連動
    const tl = calculateTrendlineAt(candles, t, paramBars + 5);

    if (tl && tl.value !== null) {
      const isBreak = price > tl.value && parseFloat(candles[t - 1].close) <= tl.prevValue;
      const isVolLarge = vol > vmaVal * paramVol;
      const isBullishMA = mFast > mSlow;

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
      <div style="display:flex; align-items:center; gap:6px; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.25); color: var(--warning); padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; margin-bottom: 12px;">
        <span>⏳</span>
        <span>資料接回時間：${dataTime} (防範部分價格資料過舊)</span>
      </div>

      <!-- 🛠️ 參數調整面板 -->
      <div style="background: rgba(30, 41, 59, 0.55); border: 1px solid rgba(255,255,255,0.08); padding: 12px; border-radius: 8px; margin-bottom: 14px; box-shadow: inset 0 1px 3px rgba(0,0,0,0.25);">
        <div style="font-weight: 700; font-size: 13px; color: white; margin-bottom: 10px; display: flex; align-items: center; gap: 4px;">
          <span>⚙️</span> <span>動態參數調整 (自訂回測鬆緊)</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; font-size: 12px; color: var(--text-muted);">
          <div>
            <label style="display:block; margin-bottom: 4px; color: #cbd5e1;">⏰ 選股時框：</label>
            <select id="tb_param_timeframe" style="width: 100%; background: #0f172a; border: 1px solid rgba(255,255,255,0.15); color: white; padding: 4px 8px; border-radius: 4px; outline: none; font-weight: 600; height: 28px;">
              <option value="15m" ${paramTimeframe === '15m' ? 'selected' : ''}>15分鐘</option>
              <option value="1h" ${paramTimeframe === '1h' ? 'selected' : ''}>1小時</option>
              <option value="4h" ${paramTimeframe === '4h' ? 'selected' : ''}>4小時</option>
              <option value="daily" ${paramTimeframe === 'daily' ? 'selected' : ''}>日線</option>
            </select>
          </div>
          <div>
            <label style="display:block; margin-bottom: 4px; color: #cbd5e1;">📈 高點回溯 (K棒根數)：</label>
            <input type="number" id="tb_param_bars" value="${paramBars}" min="5" max="100" style="width: 100%; background: #0f172a; border: 1px solid rgba(255,255,255,0.15); color: white; padding: 4px 8px; border-radius: 4px; outline: none; font-weight: 600; height: 28px;" />
          </div>
          <div>
            <label style="display:block; margin-bottom: 4px; color: #cbd5e1;">⚡ 快線均線 (MA)：</label>
            <input type="number" id="tb_param_ma_fast" value="${paramMaFast}" min="5" max="100" style="width: 100%; background: #0f172a; border: 1px solid rgba(255,255,255,0.15); color: white; padding: 4px 8px; border-radius: 4px; outline: none; font-weight: 600; height: 28px;" />
          </div>
          <div>
            <label style="display:block; margin-bottom: 4px; color: #cbd5e1;">🐢 慢線均線 (MA)：</label>
            <input type="number" id="tb_param_ma_slow" value="${paramMaSlow}" min="10" max="200" style="width: 100%; background: #0f172a; border: 1px solid rgba(255,255,255,0.15); color: white; padding: 4px 8px; border-radius: 4px; outline: none; font-weight: 600; height: 28px;" />
          </div>
          <div style="grid-column: span 2; display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>
              <label style="display:block; margin-bottom: 4px; color: #cbd5e1;">🔥 爆量倍數 (倍)：</label>
              <input type="number" id="tb_param_vol" value="${paramVol}" step="0.1" min="0.5" max="5" style="width: 100%; background: #0f172a; border: 1px solid rgba(255,255,255,0.15); color: white; padding: 4px 8px; border-radius: 4px; outline: none; font-weight: 600; height: 28px;" />
            </div>
            <div>
              <label style="display:block; margin-bottom: 4px; color: #cbd5e1;">📊 均量回溯 (K棒)：</label>
              <input type="number" id="tb_param_vol_n" value="${paramVolN}" min="5" max="100" style="width: 100%; background: #0f172a; border: 1px solid rgba(255,255,255,0.15); color: white; padding: 4px 8px; border-radius: 4px; outline: none; font-weight: 600; height: 28px;" />
            </div>
          </div>
        </div>
        <div style="text-align: right; margin-top: 12px;">
          <button class="btn-primary" onclick="openTrendlineBreakoutModal()" style="font-size: 12px; padding: 4px 16px; height: 28px; background: linear-gradient(135deg, #ec4899, #8b5cf6); border:none; border-radius: 4px; cursor: pointer; color:white; font-weight:700; box-shadow: 0 2px 6px rgba(236,72,153,0.35);">
            🔄 重新動態掃描
          </button>
        </div>
      </div>

      <p style="color:var(--text-muted); font-size:12px; margin-bottom: 12px; line-height: 1.5;">
        依據條件篩選：<strong>${paramTimeframe === 'daily' ? '日線' : paramTimeframe === '1h' ? '1小時' : paramTimeframe === '4h' ? '4小時' : '15分鐘'}</strong> 時框下，過去 <strong>${paramBars}</strong> 根 K 棒顯著高點連線突破 + 爆量達近 <strong>${paramVolN}</strong> 根 K 棒平均量 <strong>${paramVol}</strong> 倍以上 + <strong>MA${paramMaFast} &gt; MA${paramMaSlow}</strong> 多頭排列。本次共掃描 <strong>'股票分析清單.csv'</strong> 內 <strong>${csvStocks.length}</strong> 檔股票。
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
    currentChartSymbol = stock.id; // 提前設定以防止 switchView 載入預設股票 2330
    switchView('chart');
    setTimeout(() => loadTVChart(stock), 300);
  }
};


// ================= 🐾 荳荳柴犬吉祥物與 AI 戰術室互動邏輯 🐾 =================

const SHIBA_GOLDEN_PHRASES = [
  "🐾 荳荳今天也很努力幫您守護帳戶汪！",
  "🐾 拔麻今天也要記得按時吃飯，荳荳陪您一起看盤！",
  "🐾 汪！荳荳剛才做夢夢到股票全部拉漲停耶！",
  "🐾 拔麻，荳荳隨時準備好用小短腿去刨那些突破大飆股喔！",
  "🐾 今日的均線多頭排列有如荳荳滑順的毛髮汪！",
  "🐾 汪！大盤今天熱烘烘的，像烤熟的肉骨頭！",
  "🐾 荳荳貼心提醒：順勢交易，防守好移動停利唷！"
];

// 控制對話視窗開關
window.toggleShibaChatPanel = function(show) {
  const panel = document.getElementById('shibaChatPanel');
  const bubble = document.getElementById('shibaMascotBubble');
  if (!panel) return;

  if (show === undefined) {
    show = (panel.style.display === 'none');
  }

  if (show) {
    panel.style.display = 'flex';
    if (bubble) bubble.classList.remove('active'); // 打開面板時隱藏泡泡
    // 捲動到底部
    setTimeout(() => {
      const body = document.getElementById('shibaChatBody');
      if (body) body.scrollTop = body.scrollHeight;
    }, 50);
  } else {
    panel.style.display = 'none';
  }
};

// 荳荳大數據彙整分析引擎 (基於 mockStocks)
function compileShibaData() {
  if (typeof mockStocks === 'undefined' || mockStocks.length === 0) {
    return null;
  }

  // 1. 計算今日所有板塊/細分族群的平均漲跌幅
  const sectorGroups = {};
  mockStocks.forEach(s => {
    // 取得產業分類 (直接提取細分類主鍵如 水泥、食品、IC設計)
    let sector = '其他';
    if (typeof getStockSector === 'function') {
      const full = getStockSector(s);
      sector = full.split(':')[1] || full;
    } else if (s.industry) {
      sector = s.industry.replace('業', '');
    }

    if (!sectorGroups[sector]) {
      sectorGroups[sector] = { sumChange: 0, count: 0, stocks: [] };
    }
    sectorGroups[sector].sumChange += parseFloat(s.change || 0);
    sectorGroups[sector].count += 1;
    sectorGroups[sector].stocks.push(s);
  });

  const sectorList = [];
  for (const [name, data] of Object.entries(sectorGroups)) {
    const avgChange = data.sumChange / data.count;
    // 排序該族群成分股 (漲幅高到低)
    data.stocks.sort((a, b) => b.change - a.change);
    sectorList.push({
      name: name,
      avgChange: avgChange,
      stocks: data.stocks
    });
  }

  // 依照族群平均漲幅排序
  sectorList.sort((a, b) => b.avgChange - a.avgChange);

  // 2. 篩選出法人（外資+投信）合力買超前三名
  // mockStocks 中的外資買超為 foreignBuy=true, 且 foreignNetBuy 可代表淨買超張數
  // 加上投信天數 trustDays > 0
  const faves = [...mockStocks];
  faves.sort((a, b) => {
    const scoreA = (a.foreignNetBuy || 0) + (a.trustDays || 0) * 100;
    const scoreB = (b.foreignNetBuy || 0) + (b.trustDays || 0) * 100;
    return scoreB - scoreA;
  });
  const institutionalFavorites = faves.slice(0, 3);

  // 3. 篩選出量比最大（爆量突破）的前三名飆股
  const volumeSpikes = [...mockStocks];
  volumeSpikes.sort((a, b) => (b.volRatio || 0) - (a.volRatio || 0));
  const topVolumeSpikes = volumeSpikes.slice(0, 3);

  return {
    sectors: sectorList, // 由強到弱
    favorites: institutionalFavorites,
    volSpikes: topVolumeSpikes
  };
}

// 快捷提問
window.askShiba = function(type) {
  let userText = '';
  if (type === 'today_strong') userText = '🔥 今日大盤最強勢的板塊是哪一類股？幫我列出幾支標的清單！';
  if (type === 'today_weak') userText = '❄️ 今日大盤比較弱勢的是哪一類股？成分股表現如何？';
  if (type === 'trust_favorite') userText = '💼 法人今天最看好、同買的標的是哪些？幫我列出來！';
  if (type === 'volume_burst') userText = '⚡ 今日爆量、資金大量流入的突破飆股是哪幾支？';
  if (type === 'doudou_backtest') userText = '🐾 荳荳回測小助理！請幫我計算並篩選出符合多頭、SuperTrend多頭且下行趨勢線突破爆量的股票清單！';

  appendChatMessage(userText, 'user');

  // 荳荳開始思考回答
  setTimeout(() => {
    const data = compileShibaData();
    if (!data) {
      appendChatMessage('嗚嗚汪...荳荳發現資料庫空空的，沒辦法進行統計分析耶！拔麻要不要先確認篩選器設定汪？🐶', 'bot');
      return;
    }

    let botReply = '';
    const disclaimer = '<br><br><span style="color:var(--text-muted); font-size:10px; display:block; border-top:1px solid rgba(255,255,255,0.08); padding-top:6px; margin-top:6px;">⚠️ 拔麻注意：以上數據為荳荳從大盤合併市值前 500 大個股中動態即時彙整所得，僅供策略參考，不構成任何投資建議汪！🐶</span>';

    if (type === 'today_strong') {
      const topSect = data.sectors[0];
      const secondSect = data.sectors[1];
      
      const topStocksStr = topSect.stocks.slice(0, 5).map(s => `• <b>${s.id} ${s.name}</b> (漲幅 ${s.change >= 0 ? '+' : ''}${s.change}%, 價格 $${s.price})`).join('<br>');
      const secondStocksStr = secondSect.stocks.slice(0, 3).map(s => `• <b>${s.id} ${s.name}</b> (${s.change >= 0 ? '+' : ''}${s.change}%)`).join('<br>');

      botReply = `汪！荳荳幫拔麻統計出來囉！🐶<br>
今日大盤最強勢的板塊是 <b>${topSect.name.split(':')[0]} ➔ ${topSect.name.split(':')[1]}</b> 族群！平均今日漲幅高達 <span style="color:var(--up-color); font-weight:bold;">+${topSect.avgChange.toFixed(2)}%</span> 汪！🐾<br><br>
荳荳精選該族群前幾名強勢標的：<br>${topStocksStr}<br><br>
另外，第二強的板塊是 <b>${secondSect.name.split(':')[0]} ➔ ${secondSect.name.split(':')[1]}</b>，平均漲幅約為 +${secondSect.avgChange.toFixed(2)}%，熱門標的包含：<br>${secondStocksStr}` + disclaimer;
    } 
    else if (type === 'today_weak') {
      const weakSect = data.sectors[data.sectors.length - 1];
      const secondWeak = data.sectors[data.sectors.length - 2];

      const weakStocksStr = weakSect.stocks.slice(-5).reverse().map(s => `• <b>${s.id} ${s.name}</b> (跌幅 ${s.change >= 0 ? '+' : ''}${s.change}%, 價格 $${s.price})`).join('<br>');
      
      botReply = `汪嗚...今天比較冷清疲軟的板塊是 <b>${weakSect.name.split(':')[0]} ➔ ${weakSect.name.split(':')[1]}</b> 族群汪！平均今日跌幅為 <span style="color:var(--down-color); font-weight:bold;">${weakSect.avgChange.toFixed(2)}%</span> ❄️<br><br>
這裡面跌勢最重的標的清單：<br>${weakStocksStr}<br><br>
拔麻操作這些弱勢族群時，一定要嚴格執行移動停損守好錢包喔！汪！` + disclaimer;
    }
    else if (type === 'trust_favorite') {
      const favStr = data.favorites.map((s, idx) => `${idx + 1}. <b>${s.id} ${s.name}</b> (投信連買 ${s.trustDays || 0} 天, 今日外資買超張數：${s.foreignNetBuy || 0} 張, 現價 $${s.price})`).join('<br>');

      botReply = `汪汪！大戶跟法人吃肉，拔麻喝湯囉！🐾<br>
荳荳掃描大盤籌碼，發現目前法人籌碼最集中的前三名標的是：<br><br>
${favStr}<br><br>
這些股票背後都有法人金主撐腰，往往在均線糾結處更容易往上噴射，拔麻可以多加留意圖表突破訊號喔！` + disclaimer;
    }
    else if (type === 'volume_burst') {
      const spikeStr = data.volSpikes.map((s, idx) => `${idx + 1}. <b>${s.id} ${s.name}</b> (今日成交量比平常暴增 <b>${s.volRatio || 1}</b> 倍！現價 $${s.price}, 漲幅 ${s.change >= 0 ? '+' : ''}${s.change}%)`).join('<br>');

      botReply = `轟隆汪！今日爆量資金搶進的狂熱標的來了！🔥<br>
成交量是股票的靈魂，荳荳幫拔麻抓出今天量能增幅最誇張的飆股前三名：<br><br>
${spikeStr}<br><br>
大量通常代表有主力吃貨或利多引爆，很容易觸發我們的「下行趨勢線突破」策略汪！快點擊 K 線頁面看看吧！` + disclaimer;
    }
    else if (type === 'doudou_backtest') {
      // 荳荳回測計算邏輯
      const matched = [];
      mockStocks.forEach(s => {
        if (!s.kline || s.kline.length < 60) return;
        
        // 取得整理後的 K 線
        const candles = s.kline.map(d => ({
          time: d.date || d.time,
          open: parseFloat(d.open),
          high: parseFloat(d.high),
          low: parseFloat(d.low),
          close: parseFloat(d.close),
          volume: parseFloat(d.volume || 0)
        }));

        const t = candles.length - 1;
        if (t < 25) return;
        const curr = candles[t];
        const price = curr.close;
        const vol = curr.volume;

        // A. 必要條件: Supertrend
        const stData = calculateSupertrend(candles, 10, 3);
        if (stData.length === 0) return;
        const currSt = stData[stData.length - 1];
        if (!currSt || currSt.trend !== 1 || price <= currSt.value) return;

        // A. 必要條件: MA20 > MA60
        const ma20Arr = calculateSMA(candles, 20);
        const ma60Arr = calculateSMA(candles, 60);
        const m20 = ma20Arr.find(m => m.time === curr.time);
        const m60 = ma60Arr.find(m => m.time === curr.time);
        if (!m20 || !m60 || m20.value <= m60.value) return;

        // A. 必要條件: 過去 20 根 K 棒下降趨勢線已被突破
        const tl = calculateTrendlineAt(candles, t);
        if (!tl || tl.value === null) return;
        const isBreak = price > tl.value && parseFloat(candles[t - 1].close) <= tl.prevValue;
        if (!isBreak) return;

        // B. 觸發條件: 突破當根量 > 20日均量 1.5 倍 (量倍比)
        const vma = calculateVolumeMA(candles, 20);
        const vmaVal = vma[t];
        const volRatio = vol / vmaVal;
        if (volRatio < 1.5) return;

        // B. 觸發條件: 收盤價站穩突破線上方 && 突破後不立即跌回突破線下方 (由於當根剛突破，滿足 price > tl.value)

        matched.push({
          id: s.id,
          name: s.name,
          price: price,
          change: s.change,
          volRatio: volRatio.toFixed(2),
          sector: s.type || '一般板塊'
        });
      });

      // 依量倍比由大到小排序
      matched.sort((a, b) => b.volRatio - a.volRatio);

      if (matched.length === 0) {
        botReply = `汪嗚... 荳荳用全力跑了回測，但在目前 ${mockStocks.length} 檔標的內，<b>沒有任何股票</b>同時滿足您的：<br>
1. <b>Supertrend 多頭排列 (Price > Supertrend)</b><br>
2. <b>MA20 > MA60</b><br>
3. <b>下行趨勢線突破 + 量倍比 >= 1.5 倍</b><br>
拔麻可以稍微放寬條件或等明天開盤數據更新再試試看汪！🐶`;
      } else {
        const rowsHTML = matched.slice(0, 10).map((s, idx) => 
          `• <b>${idx + 1}. ${s.id} ${s.name}</b><br>` +
          `  現價: $${s.price} (漲跌: ${s.change >= 0 ? '+' : ''}${s.change}%)<br>` +
          `  ⚡ <b>量倍比: ${s.volRatio} 倍</b><br>` +
          `  🔍 <a href="javascript:void(0)" onclick="switchView('chart'); loadStockToChart('${s.id}')" style="color:var(--primary); font-weight:bold; text-decoration:underline;">點此載入 K 線回測</a>`
        ).join('<br><br>');

        botReply = `🐾 <b>荳荳回測小助理報告！</b> 🐶<br>
荳荳幫拔麻完成大數據回測運算囉！在全市場前 500 大中，共有 <b>${matched.length}</b> 檔完全符合您的策略條件！以下為您列出前 10 檔（依<b>量倍比</b>排序）：<br><br>
${rowsHTML}` + disclaimer;
      }
    }

    appendChatMessage(botReply, 'bot');
  }, 600);
};

// 手動送出訊息與 NLP 問答匹配
window.sendShibaMessage = function() {
  const input = document.getElementById('shibaChatInput');
  if (!input) return;
  const val = input.value.trim();
  if (!val) return;

  appendChatMessage(val, 'user');
  input.value = '';

  // 模擬荳荳打字與回答
  setTimeout(() => {
    const data = compileShibaData();
    const disclaimer = '<br><br><span style="color:var(--text-muted); font-size:10px; display:block; border-top:1px solid rgba(255,255,255,0.08); padding-top:6px; margin-top:6px;">⚠️ 拔麻注意：以上數據為荳荳從大盤合併市值前 500 大個股中動態即時彙整所得，僅供策略參考，不構成任何投資建議汪！🐶</span>';

    if (!data) {
      appendChatMessage('嗚嗚汪...荳荳發現資料庫沒有載入股票，沒辦法統計大數據耶。', 'bot');
      return;
    }

    // 匹配關鍵字
    const query = val.toLowerCase();
    let botReply = '';

    if (query.includes('回測') || query.includes('策略') || query.includes('小助理') || query.includes('符合')) {
      // 荳荳回測計算邏輯 (與快捷鍵 doudou_backtest 同步)
      const matched = [];
      mockStocks.forEach(s => {
        if (!s.kline || s.kline.length < 60) return;
        
        // 取得整理後的 K 線
        const candles = s.kline.map(d => ({
          time: d.date || d.time,
          open: parseFloat(d.open),
          high: parseFloat(d.high),
          low: parseFloat(d.low),
          close: parseFloat(d.close),
          volume: parseFloat(d.volume || 0)
        }));

        const t = candles.length - 1;
        if (t < 25) return;
        const curr = candles[t];
        const price = curr.close;
        const vol = curr.volume;

        // A. 必要條件: Supertrend
        const stData = calculateSupertrend(candles, 10, 3);
        if (stData.length === 0) return;
        const currSt = stData[stData.length - 1];
        if (!currSt || currSt.trend !== 1 || price <= currSt.value) return;

        // A. 必要條件: MA20 > MA60
        const ma20Arr = calculateSMA(candles, 20);
        const ma60Arr = calculateSMA(candles, 60);
        const m20 = ma20Arr.find(m => m.time === curr.time);
        const m60 = ma60Arr.find(m => m.time === curr.time);
        if (!m20 || !m60 || m20.value <= m60.value) return;

        // A. 必要條件: 過去 20 根 K 棒下降趨勢線已被突破
        const tl = calculateTrendlineAt(candles, t);
        if (!tl || tl.value === null) return;
        const isBreak = price > tl.value && parseFloat(candles[t - 1].close) <= tl.prevValue;
        if (!isBreak) return;

        // B. 觸發條件: 突破當根量 > 20日均量 1.5 倍 (量倍比)
        const vma = calculateVolumeMA(candles, 20);
        const vmaVal = vma[t];
        const volRatio = vol / vmaVal;
        if (volRatio < 1.5) return;

        matched.push({
          id: s.id,
          name: s.name,
          price: price,
          change: s.change,
          volRatio: volRatio.toFixed(2),
          sector: s.type || '一般板塊'
        });
      });

      // 依量倍比由大到小排序
      matched.sort((a, b) => b.volRatio - a.volRatio);

      if (matched.length === 0) {
        botReply = `汪嗚... 荳荳用全力跑了回測，但在目前 ${mockStocks.length} 檔標的內，<b>沒有任何股票</b>同時滿足您的：<br>
1. <b>Supertrend 多頭排列 (Price > Supertrend)</b><br>
2. <b>MA20 > MA60</b><br>
3. <b>下行趨勢線突破 + 量倍比 >= 1.5 倍</b><br>
拔麻可以稍微放寬條件或等明天開盤數據更新再試試看汪！🐶`;
      } else {
        const rowsHTML = matched.slice(0, 10).map((s, idx) => 
          `• <b>${idx + 1}. ${s.id} ${s.name}</b><br>` +
          `  現價: $${s.price} (漲跌: ${s.change >= 0 ? '+' : ''}${s.change}%)<br>` +
          `  ⚡ <b>量倍比: ${s.volRatio} 倍</b><br>` +
          `  🔍 <a href="javascript:void(0)" onclick="switchView('chart'); loadStockToChart('${s.id}')" style="color:var(--primary); font-weight:bold; text-decoration:underline;">點此載入 K 線回測</a>`
        ).join('<br><br>');

        botReply = `🐾 <b>荳荳回測小助理報告！</b> 🐶<br>
荳荳幫拔麻完成大數據回測運算囉！在全市場前 500 大中，共有 <b>${matched.length}</b> 檔完全符合您的策略條件！以下為您列出前 10 檔（依<b>量倍比</b>排序）：<br><br>
${rowsHTML}` + disclaimer;
      }
    }
    // 解析出使用者詢問的「漲幅百分比限制」 (例如: "不到 5%"、"小於 3%")
    else if (query.includes('限價') || query.includes('上漲不到') || query.includes('不到') || query.includes('小於') || query.includes('優質') || query.includes('推薦') && query.includes('%')) {
      // 智慧篩選：篩選出今日漲幅 > 0 且 < pctLimit，並且具備優質技術形態或法人同買指標的「優質股票」
      // 優質定義：maBull為true (多頭排列) 或是 foreignBuy為true，且成交量大於1000張，或評分優良的股票
      const highQualityStocks = mockStocks.filter(s => {
        const change = parseFloat(s.change || 0);
        const dailyVol = parseInt(s.dailyVol || 0);
        const isBull = s.maBull === true || s.foreignBuy === true;
        return change >= 0 && change < pctLimit && dailyVol > 800 && isBull;
      });

      // 排序：以法人買超力道或技術型態多空評分排序，選出前 5 支
      highQualityStocks.sort((a, b) => {
        const scoreA = (a.foreignNetBuy || 0) + (a.trustDays || 0) * 10;
        const scoreB = (b.foreignNetBuy || 0) + (b.trustDays || 0) * 10;
        return scoreB - scoreA;
      });

      const selected = highQualityStocks.slice(0, 5);

      if (selected.length === 0) {
        botReply = `汪嗚！荳荳在全台股前 500 大中，暫時沒有刨到今日漲幅在 <b>0% ~ ${pctLimit}%</b> 之間、且符合多頭型態的優質標的耶！🐾<br>要不要稍微放寬一下漲幅限制，或是荳荳幫您改找其他爆量突破股汪？🐶` + disclaimer;
      } else {
        const listStr = selected.map((s, idx) => {
          let reason = '';
          if (s.maBull && s.foreignBuy) reason = '🔥 多頭排列+外資同買';
          else if (s.maBull) reason = '📈 技術面均線多頭排列';
          else if (s.foreignBuy) reason = '💼 外資主力悄悄吃貨';
          else reason = '⚡ 量增強勢整理中';

          return `${idx + 1}. <b>${s.id} ${s.name}</b><br>` +
                 `   • 今日漲幅：<span style="color:var(--up-color); font-weight:700;">+${s.change}%</span> (上漲不到 ${pctLimit}%)<br>` +
                 `   • 昨收/現價：$${s.price} | 量能：${(s.dailyVol || 0).toLocaleString()}張<br>` +
                 `   • 荳荳診斷：${reason} 汪！🐶`;
        }).join('<br><br>');

        botReply = `汪！荳荳出動小短腿幫拔麻把數據刨出來囉！🐾<br>
目前系統內上漲不到 <b>${pctLimit}%</b> 且型態優良、具備法人或技術面優勢的 5 支精選標的如下：<br><br>
${listStr}<br><br>
限價與多頭格局代表下檔支撐強勁，拔麻可以點擊 K 線頁面，守好趨勢突破防守點進行回測汪！🐶` + disclaimer;
      }
    }
    else if (query.includes('漲幅') || query.includes('類股') || query.includes('強勢') || query.includes('板塊') || query.includes('推薦') || query.includes('好股') || query.includes('飆股')) {
      const topSect = data.sectors[0];
      const secondSect = data.sectors[1];
      const topStocksStr = topSect.stocks.slice(0, 4).map(s => `• <b>${s.id} ${s.name}</b> (漲幅 ${s.change >= 0 ? '+' : ''}${s.change}%, 現價 $${s.price})`).join('<br>');
      
      botReply = `汪！拔麻您問對狗了！🐾 荳荳用小短腿算了一下：<br>
今天大盤漲幅最兇悍的板塊是 <b>${topSect.name.split(':')[0]} ➔ ${topSect.name.split(':')[1]}</b> 族群，今日平均大漲 <span style="color:var(--up-color); font-weight:bold;">+${topSect.avgChange.toFixed(2)}%</span> 汪！<br><br>
荳荳幫拔麻列出該類股中最強勢的標的清單：<br>
${topStocksStr}<br><br>
還有還有！ <b>${secondSect.name.split(':')[0]} ➔ ${secondSect.name.split(':')[1]}</b> 今天平均也漲了 +${secondSect.avgChange.toFixed(2)}%，也是不可忽視的吸金板塊喔！` + disclaimer;
    }
    else if (query.includes('法人') || query.includes('外資') || query.includes('投信') || query.includes('主力')) {
      const favStr = data.favorites.map((s, idx) => `${idx + 1}. <b>${s.id} ${s.name}</b> (投信連買 ${s.trustDays || 0} 天, 今日外資淨買超 ${s.foreignNetBuy || 0} 張, 現價 $${s.price})`).join('<br>');
      botReply = `汪汪！法人跟外資大戶的籌碼流向都在荳荳的靈敏鼻子底下！👃<br>
目前市值前 500 大中，法人最看好且同買的前三名標的是：<br><br>
${favStr}` + disclaimer;
    }
    else if (query.includes('跌') || query.includes('弱勢') || query.includes('慘')) {
      const weakSect = data.sectors[data.sectors.length - 1];
      const weakStocksStr = weakSect.stocks.slice(-4).reverse().map(s => `• <b>${s.id} ${s.name}</b> (跌幅 ${s.change >= 0 ? '+' : ''}${s.change}%)`).join('<br>');
      botReply = `汪嗚...今天最冷颼颼的弱勢板塊是 <b>${weakSect.name.split(':')[0]} ➔ ${weakSect.name.split(':')[1]}</b>，今日平均跌幅達 ${weakSect.avgChange.toFixed(2)}% ❄️<br><br>
裡面主要拉回的成分股有：<br>${weakStocksStr}<br><br>
拔麻買這些股票要防守好均線或趨勢線，千萬別盲目攤平喔！` + disclaimer;
    }
    else if (query.includes('荳荳') || query.includes('哈囉') || query.includes('你好') || query.includes('誰')) {
      botReply = `汪！我是拔麻最貼心的台股智能小助理荳荳！🐶<br>
我可以透過後台 Python 爬回來的全台股市值前 500 大個股大數據，幫您即時統計出今天最吸金的強勢股、法人同買股與爆量飆股！隨時可以問我「今天漲幅最大的是什麼類股」或「推薦幾支法人買的股票」汪！🐾`;
    }
    else {
      // 兜底萬用回答
      const topSect = data.sectors[0];
      const topStocksStr = topSect.stocks.slice(0, 3).map(s => `• <b>${s.id} ${s.name}</b> (${s.change >= 0 ? '+' : ''}${s.change}%)`).join('<br>');
      botReply = `汪！荳荳對「${val}」思考了很久，雖然我的小腦袋還在學習怎麼回答這個，但荳荳建議您可以關注今天最強勢的 <b>${topSect.name.split(':')[0]} ➔ ${topSect.name.split(':')[1]}</b> 板塊汪！🐶<br><br>
今日熱門強勢股如：<br>${topStocksStr}<br><br>
您可以試著問我：「今天漲幅最大的是什麼類股？」或「推薦幾支法人股」！` + disclaimer;
    }

    appendChatMessage(botReply, 'bot');
  }, 750);
};

// 插入聊天訊息至 DOM
function appendChatMessage(text, sender) {
  const body = document.getElementById('shibaChatBody');
  if (!body) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `shiba-msg shiba-msg-${sender}`;
  msgDiv.innerHTML = `<div class="shiba-msg-text">${text}</div>`;
  body.appendChild(msgDiv);

  // 捲動到底部
  body.scrollTop = body.scrollHeight;
}

window.triggerShibaMascotTalk = function() {
  const bubble = document.getElementById('shibaMascotBubble');
  if (!bubble) return;
  
  const randIdx = Math.floor(Math.random() * SHIBA_GOLDEN_PHRASES.length);
  bubble.innerText = SHIBA_GOLDEN_PHRASES[randIdx];
  bubble.classList.add('active');
  
  setTimeout(() => {
    bubble.classList.remove('active');
  }, 4000);
};

window.initShibaMascotInteractions = function() {
  const bubble = document.getElementById('shibaMascotBubble');
  const avatar = document.getElementById('shibaMascotAvatar');
  if (!bubble || !avatar) return;

  setTimeout(() => {
    let healthScore = 60;
    
    // 大盤高分健康
    if (healthScore >= 75) {
      avatar.src = "photo/doudou_happy.png";
      bubble.innerText = "🐾 汪！荳荳覺得大盤超棒超健康！此時不刨突破股更待何時！今天荳荳要加肉骨頭！";
    }
    // 大盤普通
    else if (healthScore >= 45) {
      avatar.src = "photo/doudou_cute.png";
      bubble.innerText = "🐾 汪！市場平平穩穩的，荳荳乖乖坐著等好機會，拔麻要細心挑選喔！";
    }
    // 大盤弱勢危險
    else {
      avatar.src = "photo/doudou_sad.png";
      bubble.innerText = "⚠️ 嗚嗚汪...荳荳聞到危險的氣味！大盤風吹得太冷了，拔麻要注意倉位安全防守喔！";
    }
    
    bubble.classList.add('active');
    setTimeout(() => {
      bubble.classList.remove('active');
    }, 7000);
  }, 1200);
};

// 自動掛載初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', window.initShibaMascotInteractions);
} else {
  window.initShibaMascotInteractions();
}


// ============================================================================
// 🎨 荳荳 AI 智能選股圖表 — 互動式繪圖引擎實作 (Canvas Overlay Engine)
// ============================================================================

window.userDrawings = JSON.parse(localStorage.getItem('trading_ai_drawings')) || {};
window.currentDrawingTool = 'cursor';
window.currentDrawingColor = '#f97316';
window.selectedDrawingId = null;

let activeChartInstance = null;
let activeCandleSeries = null;
let activeCanvasElement = null;
let activeOverlayElement = null;

function saveDrawings() {
  localStorage.setItem('trading_ai_drawings', JSON.stringify(window.userDrawings));
}

// 點到線段的投影距離計算 (向量投射法)
function getPointToLineDistance(x, y, x1, y1, x2, y2) {
  const A = x - x1;
  const B = y - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  if (lenSq !== 0) {
    param = dot / lenSq;
  }

  let xx, yy;
  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  const dx = x - xx;
  const dy = y - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

// 偵測滑鼠是否靠近任何已有之繪圖物件 (Hit Test)
function findDrawingAt(x, y, chart, series, symbol) {
  const drawings = window.userDrawings[symbol];
  if (!drawings || drawings.length === 0) return null;

  for (let i = drawings.length - 1; i >= 0; i--) {
    const dr = drawings[i];
    if (dr.type === 'trendline') {
      const x1 = chart.timeScale().timeToCoordinate(dr.time1);
      const y1 = series.priceToCoordinate(dr.price1);
      const x2 = chart.timeScale().timeToCoordinate(dr.time2);
      const y2 = series.priceToCoordinate(dr.price2);
      if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
        const dist = getPointToLineDistance(x, y, x1, y1, x2, y2);
        if (dist < 8) return dr;
      }
    } else if (dr.type === 'horizline') {
      const yLvl = series.priceToCoordinate(dr.price);
      if (yLvl !== null && Math.abs(y - yLvl) < 8) {
        return dr;
      }
    } else if (dr.type === 'fib') {
      const y1 = series.priceToCoordinate(dr.price1);
      const y2 = series.priceToCoordinate(dr.price2);
      if (y1 !== null && y2 !== null) {
        const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
        for (const lvl of levels) {
          const yLvl = y1 + (y2 - y1) * lvl;
          if (Math.abs(y - yLvl) < 8) return dr;
        }
      }
    } else if (dr.type === 'measure') {
      const x1 = chart.timeScale().timeToCoordinate(dr.time1);
      const y1 = series.priceToCoordinate(dr.price1);
      const x2 = chart.timeScale().timeToCoordinate(dr.time2);
      const y2 = series.priceToCoordinate(dr.price2);
      if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
        const nearLeft = Math.abs(x - x1) < 8 && y >= Math.min(y1, y2) && y <= Math.max(y1, y2);
        const nearRight = Math.abs(x - x2) < 8 && y >= Math.min(y1, y2) && y <= Math.max(y1, y2);
        const nearTop = Math.abs(y - y1) < 8 && x >= Math.min(x1, x2) && x <= Math.max(x1, x2);
        const nearBottom = Math.abs(y - y2) < 8 && x >= Math.min(x1, x2) && x <= Math.max(x1, x2);
        if (nearLeft || nearRight || nearTop || nearBottom) return dr;
      }
    }
  }
  return null;
}

// 選取與反選
function selectDrawing(id) {
  window.selectedDrawingId = id;
  const delBtn = document.getElementById('btn-delete-selected');
  if (delBtn) {
    if (id) {
      delBtn.style.opacity = '1';
      delBtn.style.cursor = 'pointer';
    } else {
      delBtn.style.opacity = '0.4';
      delBtn.style.cursor = 'not-allowed';
    }
  }
  redrawCanvas();
}

// 刪除選取圖形 (確保畫在圖表上可以被移除)
window.deleteSelectedDrawing = function() {
  const symbol = currentChartSymbol;
  if (!symbol || !window.selectedDrawingId) return;
  
  if (window.userDrawings[symbol]) {
    window.userDrawings[symbol] = window.userDrawings[symbol].filter(d => d.id !== window.selectedDrawingId);
    saveDrawings();
    selectDrawing(null);
  }
};

// 一鍵清除全部
window.clearAllCurrentDrawings = function() {
  const symbol = currentChartSymbol;
  if (!symbol) return;
  
  if (confirm('確定要清除此標的之所有自訂繪圖線條嗎？🐾')) {
    window.userDrawings[symbol] = [];
    saveDrawings();
    selectDrawing(null);
  }
};

// 切換至選取指針工具
function switchToolToCursor() {
  const toolbar = document.getElementById('drawingToolbar');
  if (toolbar) {
    toolbar.querySelectorAll('.draw-btn[data-tool]').forEach(btn => {
      btn.classList.remove('active');
      if (btn.getAttribute('data-tool') === 'cursor') {
        btn.classList.add('active');
      }
    });
  }
  window.currentDrawingTool = 'cursor';
  updateOverlayPointerEvents();
}

// 更新 Overlay 滑鼠事件穿透設定
function updateOverlayPointerEvents() {
  if (!activeOverlayElement) return;
  if (window.currentDrawingTool !== 'cursor') {
    activeOverlayElement.style.pointerEvents = 'auto';
    activeOverlayElement.style.cursor = 'crosshair';
  } else {
    activeOverlayElement.style.pointerEvents = 'none';
    activeOverlayElement.style.cursor = 'default';
  }
}

// 更新快捷色盤狀態
function updateColorPaletteUI(color) {
  const toolbar = document.getElementById('drawingToolbar');
  if (!toolbar) return;
  toolbar.querySelectorAll('.color-dot-btn').forEach(btn => {
    btn.classList.remove('active');
    btn.style.borderColor = 'transparent';
    if (btn.getAttribute('data-color') === color) {
      btn.classList.add('active');
      btn.style.borderColor = 'white';
    }
  });
  window.currentDrawingColor = color;
}

// 設置並初始化 Canvas 與事件 (renderLWChart 中調用)
window.setupDrawingEvents = function(mainDiv, chart, series) {
  let canvas = mainDiv.querySelector('#drawingCanvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'drawingCanvas';
    canvas.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:5;';
    mainDiv.appendChild(canvas);
  }

  let overlay = mainDiv.querySelector('#drawingOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'drawingOverlay';
    overlay.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:6; background:transparent;';
    mainDiv.appendChild(overlay);
  }

  activeChartInstance = chart;
  activeCandleSeries = series;
  activeCanvasElement = canvas;
  activeOverlayElement = overlay;

  function resize() {
    const rect = mainDiv.getBoundingClientRect();
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    
    const ctx = canvas.getContext('2d');
    ctx.restore();
    ctx.save();
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  }

  resize();

  // 監聽圖表縮放/滾動
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
    redrawCanvas();
  });
  
  chart.timeScale().subscribeSizeChange(() => {
    resize();
    redrawCanvas();
  });

  let isDrawing = false;
  let dragStartPercentX = 0;
  let dragStartPercentY = 0;
  let tempDrawing = null;

  overlay.addEventListener('mousedown', (e) => {
    const rect = overlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const time = chart.timeScale().coordinateToTime(x);
    const price = series.coordinateToPrice(y);

    if (time === null || price === null) return;
    const symbol = currentChartSymbol;
    if (!symbol) return;

    if (window.currentDrawingTool === 'cursor') {
      const clickedDrawing = findDrawingAt(x, y, chart, series, symbol);
      if (clickedDrawing) {
        selectDrawing(clickedDrawing.id);
        updateColorPaletteUI(clickedDrawing.color);
      } else {
        selectDrawing(null);
      }
    } else {
      isDrawing = true;
      const drawingId = Date.now() + Math.round(Math.random() * 1000);
      
      if (window.currentDrawingTool === 'trendline') {
        tempDrawing = {
          id: drawingId,
          type: 'trendline',
          time1: time,
          price1: price,
          time2: time,
          price2: price,
          color: window.currentDrawingColor
        };
      } else if (window.currentDrawingTool === 'horizline') {
        const newDrawing = {
          id: drawingId,
          type: 'horizline',
          price: price,
          color: window.currentDrawingColor
        };
        if (!window.userDrawings[symbol]) window.userDrawings[symbol] = [];
        window.userDrawings[symbol].push(newDrawing);
        saveDrawings();
        isDrawing = false;
        tempDrawing = null;
        
        switchToolToCursor();
        selectDrawing(newDrawing.id);
      } else if (window.currentDrawingTool === 'fib') {
        tempDrawing = {
          id: drawingId,
          type: 'fib',
          time1: time,
          price1: price,
          time2: time,
          price2: price,
          color: window.currentDrawingColor
        };
      } else if (window.currentDrawingTool === 'measure') {
        tempDrawing = {
          id: drawingId,
          type: 'measure',
          time1: time,
          price1: price,
          time2: time,
          price2: price,
          color: window.currentDrawingColor
        };
      }
      redrawCanvas();
    }
  });

  overlay.addEventListener('mousemove', (e) => {
    const rect = overlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const time = chart.timeScale().coordinateToTime(x);
    const price = series.coordinateToPrice(y);
    const symbol = currentChartSymbol;

    if (isDrawing && tempDrawing && time !== null && price !== null) {
      if (tempDrawing.type === 'trendline' || tempDrawing.type === 'fib' || tempDrawing.type === 'measure') {
        tempDrawing.time2 = time;
        tempDrawing.price2 = price;
      }
      redrawCanvas();
    } else if (window.currentDrawingTool === 'cursor' && symbol) {
      const hoveredDrawing = findDrawingAt(x, y, chart, series, symbol);
      if (hoveredDrawing) {
        overlay.style.pointerEvents = 'auto';
        overlay.style.cursor = 'pointer';
      } else {
        overlay.style.pointerEvents = 'none';
        overlay.style.cursor = 'default';
      }
    }
  });

  overlay.addEventListener('mouseup', (e) => {
    const symbol = currentChartSymbol;
    if (isDrawing && tempDrawing && symbol) {
      if (!window.userDrawings[symbol]) window.userDrawings[symbol] = [];
      const isTooSmall = tempDrawing.time1 === tempDrawing.time2 && Math.abs(tempDrawing.price1 - tempDrawing.price2) < 0.001;
      
      if (!isTooSmall) {
        window.userDrawings[symbol].push(tempDrawing);
        saveDrawings();
        selectDrawing(tempDrawing.id);
      }
      
      isDrawing = false;
      tempDrawing = null;
      switchToolToCursor();
    }
  });

  mainDiv.addEventListener('mousemove', (e) => {
    if (isDrawing || window.currentDrawingTool !== 'cursor') return;
    
    const rect = overlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const chartWidth = chart.timeScale().width();
    const chartHeight = rect.height - 26;
    
    if (x < 0 || x > chartWidth || y < 0 || y > chartHeight) {
      overlay.style.pointerEvents = 'none';
      overlay.style.cursor = 'default';
      return;
    }

    const symbol = currentChartSymbol;
    if (symbol) {
      const hoveredDrawing = findDrawingAt(x, y, chart, series, symbol);
      if (hoveredDrawing) {
        overlay.style.pointerEvents = 'auto';
        overlay.style.cursor = 'pointer';
      } else {
        overlay.style.pointerEvents = 'none';
        overlay.style.cursor = 'default';
      }
    }
  });

  window.getTempDrawing = function() {
    return tempDrawing;
  };
  
  redrawCanvas();
};

// 重繪 Canvas 畫布
window.redrawCanvas = function() {
  const canvas = activeCanvasElement;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const chart = activeChartInstance;
  const series = activeCandleSeries;
  const symbol = currentChartSymbol;

  ctx.clearRect(0, 0, canvas.width / window.devicePixelRatio, canvas.height / window.devicePixelRatio);
  if (!chart || !series || !symbol) return;

  const drawings = window.userDrawings[symbol] || [];
  const temp = window.getTempDrawing ? window.getTempDrawing() : null;

  const listToDraw = [...drawings];
  if (temp) listToDraw.push(temp);

  const chartWidth = chart.timeScale().width();
  const rect = canvas.getBoundingClientRect();
  const chartHeight = rect.height - 26;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, chartWidth, chartHeight);
  ctx.clip();

  listToDraw.forEach(dr => {
    const isSelected = dr.id === window.selectedDrawingId;
    ctx.strokeStyle = dr.color;
    ctx.fillStyle = dr.color;
    ctx.lineWidth = isSelected ? 2.5 : 1.5;

    if (dr.type === 'trendline') {
      const x1 = chart.timeScale().timeToCoordinate(dr.time1);
      const y1 = series.priceToCoordinate(dr.price1);
      const x2 = chart.timeScale().timeToCoordinate(dr.time2);
      const y2 = series.priceToCoordinate(dr.price2);

      if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        if (isSelected) {
          ctx.fillStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x1, y1, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(x2, y2, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    } else if (dr.type === 'horizline') {
      const yLvl = series.priceToCoordinate(dr.price);
      if (yLvl !== null) {
        ctx.beginPath();
        ctx.setLineDash([5, 5]);
        ctx.moveTo(0, yLvl);
        ctx.lineTo(chartWidth, yLvl);
        ctx.stroke();
        ctx.setLineDash([]);

        if (isSelected) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(chartWidth / 2, yLvl, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    } else if (dr.type === 'fib') {
      const x1 = chart.timeScale().timeToCoordinate(dr.time1);
      const y1 = series.priceToCoordinate(dr.price1);
      const x2 = chart.timeScale().timeToCoordinate(dr.time2);
      const y2 = series.priceToCoordinate(dr.price2);

      if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.setLineDash([3, 3]);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);

        const levels = [
          { lvl: 0.0, label: '0.0%' },
          { lvl: 0.236, label: '23.6%' },
          { lvl: 0.382, label: '38.2%' },
          { lvl: 0.5, label: '50.0%' },
          { lvl: 0.618, label: '61.8%' },
          { lvl: 0.786, label: '78.6%' },
          { lvl: 1.0, label: '100.0%' }
        ];

        levels.forEach(item => {
          const yLvl = y1 + (y2 - y1) * item.lvl;
          const priceLvl = dr.price1 + (dr.price2 - dr.price1) * item.lvl;
          
          ctx.strokeStyle = dr.color;
          ctx.beginPath();
          ctx.moveTo(Math.min(x1, x2), yLvl);
          ctx.lineTo(Math.max(x1, x2), yLvl);
          ctx.stroke();

          ctx.fillStyle = dr.color;
          ctx.font = '10px Inter';
          ctx.textAlign = 'left';
          ctx.fillText(`${item.label} (${priceLvl.toFixed(1)})`, Math.min(x1, x2) + 6, yLvl - 4);
        });

        if (isSelected) {
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = dr.color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x1, y1, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(x2, y2, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    } else if (dr.type === 'measure') {
      const x1 = chart.timeScale().timeToCoordinate(dr.time1);
      const y1 = series.priceToCoordinate(dr.price1);
      const x2 = chart.timeScale().timeToCoordinate(dr.time2);
      const y2 = series.priceToCoordinate(dr.price2);

      if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
        ctx.fillStyle = dr.color === '#ffffff' ? 'rgba(255, 255, 255, 0.08)' : dr.color + '15';
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);

        ctx.strokeStyle = dr.color;
        ctx.lineWidth = 1;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

        const pct = ((dr.price2 - dr.price1) / dr.price1 * 100).toFixed(2);
        const diffPrice = (dr.price2 - dr.price1).toFixed(1);
        
        let kCountText = '';
        if (currentKlineData) {
          const idx1 = currentKlineData.findIndex(c => c.date === dr.time1 || c.time === dr.time1);
          const idx2 = currentKlineData.findIndex(c => c.date === dr.time2 || c.time === dr.time2);
          if (idx1 !== -1 && idx2 !== -1) {
            const count = Math.abs(idx2 - idx1) + 1;
            kCountText = ` | ${count} 根 K棒`;
          }
        }

        const text = `${pct >= 0 ? '+' : ''}${pct}% (${diffPrice}元)${kCountText}`;
        ctx.font = '11px Noto Sans TC';
        const textWidth = ctx.measureText(text).width;
        const boxX = x1 + (x2 - x1) / 2 - textWidth / 2 - 8;
        const boxY = y1 + (y2 - y1) / 2 - 10;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fillRect(boxX, boxY, textWidth + 16, 20);
        ctx.strokeStyle = dr.color;
        ctx.lineWidth = 1;
        ctx.strokeRect(boxX, boxY, textWidth + 16, 20);

        ctx.fillStyle = pct >= 0 ? '#ef4444' : '#22c55e';
        ctx.textAlign = 'center';
        ctx.fillText(text, x1 + (x2 - x1) / 2, y1 + (y2 - y1) / 2 + 4);

        if (isSelected) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(x1, y1, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(x2, y2, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }
  });

  ctx.restore();
};

// 綁定工具列 UI 事件
document.addEventListener('DOMContentLoaded', () => {
  const toolbar = document.getElementById('drawingToolbar');
  if (toolbar) {
    toolbar.querySelectorAll('.draw-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        toolbar.querySelectorAll('.draw-btn[data-tool]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        window.currentDrawingTool = btn.getAttribute('data-tool');
        
        if (window.currentDrawingTool !== 'cursor') {
          selectDrawing(null);
        }
        updateOverlayPointerEvents();
      });
    });

    toolbar.querySelectorAll('.color-dot-btn').forEach(btn => {
      const color = btn.getAttribute('data-color');
      if (color === window.currentDrawingColor) {
        btn.classList.add('active');
        btn.style.borderColor = 'white';
      }
      
      btn.addEventListener('click', () => {
        toolbar.querySelectorAll('.color-dot-btn').forEach(b => {
          b.classList.remove('active');
          b.style.borderColor = 'transparent';
        });
        btn.classList.add('active');
        btn.style.borderColor = 'white';
        window.currentDrawingColor = color;

        if (window.selectedDrawingId) {
          const symbol = currentChartSymbol;
          if (symbol && window.userDrawings[symbol]) {
            const dr = window.userDrawings[symbol].find(d => d.id === window.selectedDrawingId);
            if (dr) {
              dr.color = color;
              saveDrawings();
              redrawCanvas();
            }
          }
        }
      });
    });
    
    const delBtn = document.getElementById('btn-delete-selected');
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        deleteSelectedDrawing();
      });
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        return;
      }
      deleteSelectedDrawing();
    }
  });
});


