const fs = require('fs');
const path = require('path');

// 載入 mockStocks
console.log('正在載入數據...');
const dataContent = fs.readFileSync(path.join(__dirname, '../data.js'), 'utf8');
const sandbox = {};
const fn = new Function('sandbox', dataContent + '\nreturn mockStocks;');
const mockStocks = fn(sandbox);

const targetIds = ['2059', '5289', '5425', '3711', '2344'];
const stocks = mockStocks.filter(s => targetIds.includes(s.id));

console.log(`成功載入對應標的，共找到 ${stocks.length} 檔：`, stocks.map(s => `${s.id} ${s.name}`));

// ── 輔助函數區 ──
function calculateSMA(data, period, key = 'close') {
  const sma = new Array(data.length).fill(null);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += parseFloat(data[i][key]);
    if (i >= period - 1) {
      if (i >= period) {
        sum -= parseFloat(data[i - period][key]);
      }
      sma[i] = sum / period;
    }
  }
  return sma;
}

function calculateATR(data, period = 14) {
  const tr = new Array(data.length).fill(0);
  const atr = new Array(data.length).fill(null);
  for (let i = 0; i < data.length; i++) {
    const high = parseFloat(data[i].high);
    const low = parseFloat(data[i].low);
    if (i === 0) {
      tr[i] = high - low;
    } else {
      const prevClose = parseFloat(data[i - 1].close);
      tr[i] = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    }
  }
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  atr[period - 1] = sum / period;
  for (let i = period; i < data.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  return atr;
}

function calculateSupertrend(data, period = 10, multiplier = 3) {
  if (data.length < period) return [];
  const atr = calculateATR(data, period);
  const supertrend = [];
  const up = new Array(data.length).fill(0);
  const dn = new Array(data.length).fill(0);
  const trend = new Array(data.length).fill(1);
  
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      supertrend.push({ value: null, trend: 1 });
      continue;
    }
    const src = (parseFloat(data[i].high) + parseFloat(data[i].low)) / 2;
    const currentAtr = atr[i];
    const basicUp = src - multiplier * currentAtr;
    const basicDn = src + multiplier * currentAtr;
    
    if (i === period - 1) {
      up[i] = basicUp;
      dn[i] = basicDn;
      trend[i] = 1;
      supertrend.push({ value: basicUp, trend: 1 });
      continue;
    }
    
    const prevUp = up[i - 1];
    const prevDn = dn[i - 1];
    const prevClose = parseFloat(data[i - 1].close);
    
    if (prevClose > prevUp) {
      up[i] = Math.max(basicUp, prevUp);
    } else {
      up[i] = basicUp;
    }
    
    if (prevClose < prevDn) {
      dn[i] = Math.min(basicDn, prevDn);
    } else {
      dn[i] = basicDn;
    }
    
    const prevTrend = trend[i - 1];
    const currClose = parseFloat(data[i].close);
    
    if (prevTrend === 1 && currClose < up[i]) {
      trend[i] = -1;
    } else if (prevTrend === -1 && currClose > dn[i]) {
      trend[i] = 1;
    } else {
      trend[i] = prevTrend;
    }
    
    const val = trend[i] === 1 ? up[i] : dn[i];
    supertrend.push({ value: val, trend: trend[i] });
  }
  return supertrend;
}

// 趨勢線Pivot高點突破檢測
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
      pivots.push({ index: i, high: targetHigh });
    }
  }
  return pivots;
}

function calculateTrendlineAt(candles, t) {
  const pivots = getPivotHighsUntil(candles, t);
  if (pivots.length < 2) return null;
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
  if (t - pt2.index > 40) return null;
  const slope = (pt2.high - pt1.high) / (pt2.index - pt1.index);
  const valAtT = pt2.high + slope * (t - pt2.index);
  const valAtPrev = pt2.high + slope * (t - 1 - pt2.index);
  return { value: valAtT, prevValue: valAtPrev };
}

// ── 執行回測 ──
stocks.forEach(stock => {
  const kline = stock.kline;
  if (!kline || kline.length < 50) {
    console.log(`\n⚠️ [${stock.id} ${stock.name}] 歷史K線數據不足，無法回測`);
    return;
  }
  
  console.log(`\n=================== 📈 標的分析：[${stock.id} ${stock.name}] ===================`);
  console.log(`歷史數據區間: ${kline[0].date || kline[0].time} ~ ${kline[kline.length - 1].date || kline[kline.length - 1].time} (共 ${kline.length} 根日K)`);
  
  const close = parseFloat(kline[kline.length - 1].close);
  const volume = parseFloat(kline[kline.length - 1].volume);
  console.log(`最新狀態 ── 收盤價: ${close} 元 | 今日成交量: ${volume} 張`);

  // 1. Supertrend (10, 3) 策略回測
  const st = calculateSupertrend(kline, 10, 3);
  let stEquity = 1.0;
  let stPos = null;
  let stTrades = [];
  
  for (let i = 1; i < st.length; i++) {
    const prev = st[i - 1];
    const curr = st[i];
    const price = parseFloat(kline[i].close);
    const date = kline[i].date || kline[i].time;
    
    if (prev.trend === -1 && curr.trend === 1) {
      // 買入
      if (stPos === null) {
        stPos = { buyPrice: price, date: date };
      }
    } else if (prev.trend === 1 && curr.trend === -1) {
      // 賣出
      if (stPos !== null) {
        const profitPct = (price - stPos.buyPrice) / stPos.buyPrice;
        stEquity = stEquity * (1 + profitPct);
        stTrades.push({ buyDate: stPos.date, sellDate: date, buyPrice: stPos.buyPrice, sellPrice: price, profit: (profitPct * 100).toFixed(2) + '%' });
        stPos = null;
      }
    }
  }
  // 若最後仍持有，未實現平倉計算
  if (stPos !== null) {
    const lastPrice = parseFloat(kline[kline.length - 1].close);
    const profitPct = (lastPrice - stPos.buyPrice) / stPos.buyPrice;
    stTrades.push({ buyDate: stPos.date, sellDate: '至今未平倉', buyPrice: stPos.buyPrice, sellPrice: lastPrice, profit: (profitPct * 100).toFixed(2) + '% (未平倉)' });
    stEquity = stEquity * (1 + profitPct);
  }

  // 2. 下行趨勢線突破 + 爆量 + MA多頭 策略回測
  const ma20 = calculateSMA(kline, 20);
  const ma60 = calculateSMA(kline, 60);
  const vma20 = calculateSMA(kline, 20, 'volume');
  
  let tlEquity = 1.0;
  let tlPos = null;
  let tlTrades = [];
  
  for (let t = 20; t < kline.length; t++) {
    const price = parseFloat(kline[t].close);
    const vol = parseFloat(kline[t].volume);
    const date = kline[t].date || kline[t].time;
    
    const m20 = ma20[t];
    const m60 = ma60[t];
    const vma = vma20[t];
    
    if (tlPos === null) {
      const tl = calculateTrendlineAt(kline, t);
      if (tl && tl.value !== null) {
        const isBreak = price > tl.value && parseFloat(kline[t - 1].close) <= tl.prevValue;
        const isVolLarge = vol > vma * 1.5;
        const isBullishMA = m20 > m60;
        
        if (isBreak && isVolLarge && isBullishMA) {
          tlPos = { buyPrice: price, date: date };
        }
      }
    } else {
      // 賣出訊號：收盤跌破 20MA
      if (price < m20) {
        const profitPct = (price - tlPos.buyPrice) / tlPos.buyPrice;
        tlEquity = tlEquity * (1 + profitPct);
        tlTrades.push({ buyDate: tlPos.date, sellDate: date, buyPrice: tlPos.buyPrice, sellPrice: price, profit: (profitPct * 100).toFixed(2) + '%' });
        tlPos = null;
      }
    }
  }
  if (tlPos !== null) {
    const lastPrice = parseFloat(kline[kline.length - 1].close);
    const profitPct = (lastPrice - tlPos.buyPrice) / tlPos.buyPrice;
    tlTrades.push({ buyDate: tlPos.date, sellDate: '至今未平倉', buyPrice: tlPos.buyPrice, sellPrice: lastPrice, profit: (profitPct * 100).toFixed(2) + '% (未平倉)' });
    tlEquity = tlEquity * (1 + profitPct);
  }

  // 輸出報告
  console.log(`[策略 1] 超級趨勢 Supertrend (10, 3) 回測結果:`);
  console.log(`   └ 交易次數: ${stTrades.length} 次`);
  console.log(`   └ 累計報酬率: ${((stEquity - 1.0) * 100).toFixed(2)}%`);
  if (stTrades.length > 0) {
    console.log(`   └ 歷史交易明細:`);
    stTrades.forEach((tr, i) => {
      console.log(`      (${i+1}) 買入: ${tr.buyDate} (${tr.buyPrice}) -> 賣出: ${tr.sellDate} (${tr.sellPrice}) | 損益: ${tr.profit}`);
    });
  }

  console.log(`[策略 2] 下行趨勢線突破 + 爆量(1.5x) + 均線多頭 回測結果:`);
  console.log(`   └ 交易次數: ${tlTrades.length} 次`);
  console.log(`   └ 累計報酬率: ${((tlEquity - 1.0) * 100).toFixed(2)}%`);
  if (tlTrades.length > 0) {
    console.log(`   └ 歷史交易明細:`);
    tlTrades.forEach((tr, i) => {
      console.log(`      (${i+1}) 買入: ${tr.buyDate} (${tr.buyPrice}) -> 賣出: ${tr.sellDate} (${tr.sellPrice}) | 損益: ${tr.profit}`);
    });
  }
});
