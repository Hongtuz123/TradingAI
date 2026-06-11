const fs = require('fs');
const path = require('path');

// 載入 mockStocks
const dataContent = fs.readFileSync(path.join(__dirname, '../data.js'), 'utf8');
const sandbox = {};
const fn = new Function('sandbox', dataContent + '\nreturn mockStocks;');
const mockStocks = fn(sandbox);

console.log(`成功載入 ${mockStocks.length} 檔標的資料。`);

// 輔助函數：SMA
function calculateSMA(data, period, key = 'close') {
  const sma = new Array(data.length).fill(null);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const val = parseFloat(data[i][key]);
    sum += val;
    if (i >= period - 1) {
      if (i >= period) {
        sum -= parseFloat(data[i - period][key]);
      }
      sma[i] = sum / period;
    }
  }
  return sma;
}

// 輔助函數：計算 ATR (用於 Supertrend)
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
      tr[i] = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
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

// 輔助函數：計算 Supertrend
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

// 輔助函數：計算 DMI (Wilder's DMI & ADX)
function calculateDMI(data, period = 14) {
  const len = data.length;
  const plusDM = new Array(len).fill(0);
  const minusDM = new Array(len).fill(0);
  const tr = new Array(len).fill(0);
  
  for (let i = 0; i < len; i++) {
    const high = parseFloat(data[i].high);
    const low = parseFloat(data[i].low);
    if (i === 0) {
      tr[i] = high - low;
    } else {
      const prevHigh = parseFloat(data[i - 1].high);
      const prevLow = parseFloat(data[i - 1].low);
      const prevClose = parseFloat(data[i - 1].close);
      
      tr[i] = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      
      const upMove = high - prevHigh;
      const downMove = prevLow - low;
      
      plusDM[i] = (upMove > 0 && upMove > downMove) ? upMove : 0;
      minusDM[i] = (downMove > 0 && downMove > upMove) ? downMove : 0;
    }
  }
  
  // Wilder's Smooth
  const trSmooth = new Array(len).fill(0);
  const plusDMSmooth = new Array(len).fill(0);
  const minusDMSmooth = new Array(len).fill(0);
  
  let trSum = 0, plusSum = 0, minusSum = 0;
  for (let i = 0; i < period; i++) {
    trSum += tr[i];
    plusSum += plusDM[i];
    minusSum += minusDM[i];
  }
  trSmooth[period - 1] = trSum;
  plusDMSmooth[period - 1] = plusSum;
  minusDMSmooth[period - 1] = minusSum;
  
  for (let i = period; i < len; i++) {
    trSmooth[i] = trSmooth[i - 1] - (trSmooth[i - 1] / period) + tr[i];
    plusDMSmooth[i] = plusDMSmooth[i - 1] - (plusDMSmooth[i - 1] / period) + plusDM[i];
    minusDMSmooth[i] = minusDMSmooth[i - 1] - (minusDMSmooth[i - 1] / period) + minusDM[i];
  }
  
  const plusDI = new Array(len).fill(null);
  const minusDI = new Array(len).fill(null);
  const dx = new Array(len).fill(null);
  
  for (let i = period - 1; i < len; i++) {
    const ts = trSmooth[i];
    if (ts > 0) {
      plusDI[i] = (plusDMSmooth[i] / ts) * 100;
      minusDI[i] = (minusDMSmooth[i] / ts) * 100;
    } else {
      plusDI[i] = 0;
      minusDI[i] = 0;
    }
    const diff = Math.abs(plusDI[i] - minusDI[i]);
    const sum = plusDI[i] + minusDI[i];
    dx[i] = sum > 0 ? (diff / sum) * 100 : 0;
  }
  
  const adx = new Array(len).fill(null);
  let dxSum = 0;
  for (let i = period - 1; i < period * 2 - 1; i++) {
    dxSum += dx[i] || 0;
  }
  adx[period * 2 - 2] = dxSum / period;
  
  for (let i = period * 2 - 1; i < len; i++) {
    adx[i] = ((adx[i - 1] * (period - 1)) + dx[i]) / period;
  }
  
  return { plusDI, minusDI, adx };
}

const backtestResults = [];
const currentMatchingStocks = [];

const backtestResults60 = [];
const currentMatchingStocks60 = [];

mockStocks.forEach(stock => {
  if (!stock.kline || stock.kline.length < 100) return; // 60MA 只需要 100 天以上
  
  const kline = stock.kline;
  const len = kline.length;
  
  const ma200 = calculateSMA(kline, 200, 'close');
  const ma60 = calculateSMA(kline, 60, 'close');
  const st = calculateSupertrend(kline, 10, 3);
  const { plusDI, minusDI, adx } = calculateDMI(kline, 14);
  
  for (let i = 60; i < len; i++) {
    const close = parseFloat(kline[i].close);
    const ma200Val = ma200[i];
    const ma60Val = ma60[i];
    
    const cond2 = adx[i] !== null && adx[i] > 20 && plusDI[i] !== null && minusDI[i] !== null && plusDI[i] > minusDI[i];
    const cond3 = st[i] && st[i].trend === 1;
    
    // 200MA 策略
    const cond1_200 = ma200Val !== null && close > ma200Val;
    const isMatching200 = cond1_200 && cond2 && cond3;
    
    // 60MA 策略
    const cond1_60 = ma60Val !== null && close > ma60Val;
    const isMatching60 = cond1_60 && cond2 && cond3;
    
    // 檢查昨天 (DMI 突破第一天)
    let isTrigger200 = false;
    let isTrigger60 = false;
    
    if (i > 60) {
      const prevClose = parseFloat(kline[i - 1].close);
      const prevMa200 = ma200[i - 1];
      const prevMa60 = ma60[i - 1];
      
      const prevCond2 = adx[i - 1] !== null && adx[i - 1] > 20 && plusDI[i - 1] !== null && minusDI[i - 1] !== null && plusDI[i - 1] > minusDI[i - 1];
      const prevCond3 = st[i - 1] && st[i - 1].trend === 1;
      
      const prevMatching200 = prevMa200 !== null && prevClose > prevMa200 && prevCond2 && prevCond3;
      const prevMatching60 = prevMa60 !== null && prevClose > prevMa60 && prevCond2 && prevCond3;
      
      if (isMatching200 && !prevMatching200) isTrigger200 = true;
      if (isMatching60 && !prevMatching60) isTrigger60 = true;
    } else {
      if (isMatching200) isTrigger200 = true;
      if (isMatching60) isTrigger60 = true;
    }
    
    const isLastDay = (i === len - 1);
    const entryPrice = close;
    
    const ret5 = i + 5 < len ? (parseFloat(kline[i + 5].close) - entryPrice) / entryPrice : null;
    const ret10 = i + 10 < len ? (parseFloat(kline[i + 10].close) - entryPrice) / entryPrice : null;
    const ret20 = i + 20 < len ? (parseFloat(kline[i + 20].close) - entryPrice) / entryPrice : null;
    
    const backtestItem = {
      id: stock.id,
      name: stock.name,
      date: kline[i].date || kline[i].time,
      ret5, ret10, ret20
    };
    
    const itemData = {
      id: stock.id,
      name: stock.name,
      price: close,
      change: stock.change,
      adx: adx[i] ? adx[i].toFixed(1) : '--',
      plusDI: plusDI[i] ? plusDI[i].toFixed(1) : '--',
      minusDI: minusDI[i] ? minusDI[i].toFixed(1) : '--'
    };
    
    if (isTrigger200) {
      if (isLastDay) currentMatchingStocks.push(itemData);
      else backtestResults.push(backtestItem);
    }
    
    if (isTrigger60) {
      if (isLastDay) currentMatchingStocks60.push(itemData);
      else backtestResults60.push(backtestItem);
    }
  }
});

// 分析結果
function analyzeBacktest(results) {
  const periods = [5, 10, 20];
  const stats = {};
  
  periods.forEach(p => {
    const validRuns = results.filter(r => r[`ret${p}`] !== null);
    if (validRuns.length === 0) {
      stats[p] = { count: 0, avgRet: '--', winRate: '--' };
      return;
    }
    
    const sumRet = validRuns.reduce((sum, r) => sum + r[`ret${p}`], 0);
    const winCount = validRuns.filter(r => r[`ret${p}`] > 0).length;
    
    stats[p] = {
      count: validRuns.length,
      avgRet: (sumRet / validRuns.length * 100).toFixed(2) + '%',
      winRate: (winCount / validRuns.length * 100).toFixed(2) + '%'
    };
  });
  
  return stats;
}

const stats = analyzeBacktest(backtestResults);
const stats60 = analyzeBacktest(backtestResults60);

console.log("\n=================== 📊 策略 E：200MA (年線) 多頭趨勢跟隨 ===================");
console.log("條件：股價 > 200MA 且 ADX > 20 且 +DI > -DI 且 Supertrend 為多頭");
console.log(`總觸發訊號次數: ${backtestResults.length + currentMatchingStocks.length} 次`);
console.log(`持有  5 天 ── 樣本數: ${stats[5].count} | 平均報酬率: ${stats[5].avgRet} | 勝率: ${stats[5].winRate}`);
console.log(`持有 10 天 ─ 樣本數: ${stats[10].count} | 平均報酬率: ${stats[10].avgRet} | 勝率: ${stats[10].winRate}`);
console.log(`持有 20 天 ─ 樣本數: ${stats[20].count} | 平均報酬率: ${stats[20].avgRet} | 勝率: ${stats[20].winRate}`);

console.log("\n=================== 📊 策略 F：60MA (季線) 中期趨勢跟隨 (優化擴大樣本組) ===================");
console.log("條件：股價 > 60MA 且 ADX > 20 且 +DI > -DI 且 Supertrend 為多頭");
console.log(`總觸發訊號次數: ${backtestResults60.length + currentMatchingStocks60.length} 次`);
console.log(`持有  5 天 ── 樣本數: ${stats60[5].count} | 平均報酬率: ${stats60[5].avgRet} | 勝率: ${stats60[5].winRate}`);
console.log(`持有 10 天 ─ 樣本數: ${stats60[10].count} | 平均報酬率: ${stats60[10].avgRet} | 勝率: ${stats60[10].winRate}`);
console.log(`持有 20 天 ─ 樣本數: ${stats60[20].count} | 平均報酬率: ${stats60[20].avgRet} | 勝率: ${stats60[20].winRate}`);

console.log("\n=================== 🎯 當前符合【策略 F (60MA)】之台股標的 ===================");
if (currentMatchingStocks60.length === 0) {
  console.log("今日無符合此強趨勢中期轉折訊號之標的。");
} else {
  currentMatchingStocks60.forEach(s => {
    console.log(`[${s.id} ${s.name}] 收盤: ${s.price} 元 | 漲跌幅: ${s.change}% | ADX: ${s.adx} (+DI: ${s.plusDI} > -DI: ${s.minusDI})`);
  });
}
console.log("=========================================================");
