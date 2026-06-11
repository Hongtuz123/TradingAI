const fs = require('fs');
const path = require('path');

// 載入 mockStocks
const dataContent = fs.readFileSync(path.join(__dirname, '../data.js'), 'utf8');
const sandbox = {};
const fn = new Function('sandbox', dataContent + '\nreturn mockStocks;');
const mockStocks = fn(sandbox);

console.log(`成功載入 ${mockStocks.length} 檔標的資料。`);

// 輔助函數：計算 SMA
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

// 輔助函數：計算 ATR (用 Wilder 滑動平均)
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
  
  // ATR 計算
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += tr[i];
  }
  atr[period - 1] = sum / period;
  
  for (let i = period; i < data.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  
  return atr;
}

// 輔助函數：計算 Supertrend
function calculateSupertrend(data, period = 10, multiplier = 3) {
  if (data.length < period) return [];
  const tr = [];
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      tr.push(data[i].high - data[i].low);
    } else {
      tr.push(Math.max(
        data[i].high - data[i].low,
        Math.abs(data[i].high - data[i - 1].close),
        Math.abs(data[i].low - data[i - 1].close)
      ));
    }
  }
  
  const atr = new Array(data.length).fill(0);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  atr[period - 1] = sum / period;
  for (let i = period; i < data.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  
  const supertrend = [];
  const up = new Array(data.length).fill(0);
  const dn = new Array(data.length).fill(0);
  const trend = new Array(data.length).fill(1);
  
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      supertrend.push({ time: data[i].date || data[i].time, value: null, trend: 1 });
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
      supertrend.push({ time: data[i].date || data[i].time, value: basicUp, trend: 1 });
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
    supertrend.push({ time: data[i].date || data[i].time, value: val, trend: trend[i] });
  }
  return supertrend;
}

const backtestResults = [];
const currentMatchingStocks = [];

const backtestResultsOpt = [];
const currentMatchingStocksOpt = [];

mockStocks.forEach(stock => {
  if (!stock.kline || stock.kline.length < 100) return;
  
  const kline = stock.kline;
  const len = kline.length;
  
  const vma5 = calculateSMA(kline, 5, 'volume');
  const vma20 = calculateSMA(kline, 20, 'volume');
  const atr = calculateATR(kline, 14);
  const st = calculateSupertrend(kline, 10, 3);
  
  for (let i = 60; i < len; i++) {
    const close = parseFloat(kline[i].close);
    const vol = parseFloat(kline[i].volume);
    
    // 【原策略技術條件】
    // 條件 1：週量均線爆發
    const volExp = vma5[i] > 1.5 * vma20[i] && vma5[i - 1] <= 1.5 * vma20[i - 1];
    
    // 條件 2：前一天 ATR 壓縮到 30% 內
    let maxAtr60 = 0;
    let hasValidAtr = true;
    for (let j = 2; j <= 61; j++) {
      const prevAtrVal = atr[i - j];
      if (prevAtrVal === null || prevAtrVal === undefined) {
        hasValidAtr = false;
        break;
      }
      if (prevAtrVal > maxAtr60) { maxAtr60 = prevAtrVal; }
    }
    const prevAtr = atr[i - 1];
    const atrSqueeze30 = hasValidAtr && maxAtr60 > 0 && prevAtr !== null && prevAtr <= maxAtr60 * 0.3;
    
    // 條件 3：Supertrend 轉折
    const stCurr = st[i];
    const stPrev = st[i - 1];
    const stTurnUp = stCurr && stPrev && stCurr.trend === 1 && stPrev.trend === -1;
    
    // 【優化策略 C 技術條件】
    // 條件 1：單日爆量大於 20日均量 2.0 倍 (突破表態)
    const singleVolExp = vol > 2.0 * vma20[i];
    // 條件 2：前一天 ATR 壓縮到 40% 內 (適度放寬)
    const atrSqueeze40 = hasValidAtr && maxAtr60 > 0 && prevAtr !== null && prevAtr <= maxAtr60 * 0.4;
    
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
      atrRatio: (prevAtr / maxAtr60 * 100).toFixed(1) + '%',
      volRatio: (vol / vma20[i]).toFixed(2) + 'x',
      foreignNetBuy: stock.foreignNetBuy || 0,
      trustDays: stock.trustDays || 0
    };

    // 判斷原策略
    if (volExp && atrSqueeze30 && stTurnUp) {
      if (isLastDay) currentMatchingStocks.push(itemData);
      else backtestResults.push(backtestItem);
    }
    
    // 判斷優化策略 C
    if (singleVolExp && atrSqueeze40 && stTurnUp) {
      if (isLastDay) currentMatchingStocksOpt.push(itemData);
      else backtestResultsOpt.push(backtestItem);
    }
  }
});

// 分析回測結果
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
const statsOpt = analyzeBacktest(backtestResultsOpt);

console.log("\n=================== 📊 原策略：週量均線暴發 + ATR壓縮30% + Supertrend轉折 ===================");
console.log(`總觸發訊號次數: ${backtestResults.length + currentMatchingStocks.length} 次`);
console.log(`持有  5 天 ── 樣本數: ${stats[5].count} | 平均報酬率: ${stats[5].avgRet} | 勝率: ${stats[5].winRate}`);
console.log(`持有 10 天 ─ 樣本數: ${stats[10].count} | 平均報酬率: ${stats[10].avgRet} | 勝率: ${stats[10].winRate}`);
console.log(`持有 20 天 ─ 樣本數: ${stats[20].count} | 平均報酬率: ${stats[20].avgRet} | 勝率: ${stats[20].winRate}`);

console.log("\n=================== 📊 優化策略 C：單日量暴發2倍 + ATR壓縮40% + Supertrend轉折 ===================");
console.log(`總觸發訊號次數: ${backtestResultsOpt.length + currentMatchingStocksOpt.length} 次`);
console.log(`持有  5 天 ── 樣本數: ${statsOpt[5].count} | 平均報酬率: ${statsOpt[5].avgRet} | 勝率: ${statsOpt[5].winRate}`);
console.log(`持有 10 天 ─ 樣本數: ${statsOpt[10].count} | 平均報酬率: ${statsOpt[10].avgRet} | 勝率: ${statsOpt[10].winRate}`);
console.log(`持有 20 天 ─ 樣本數: ${statsOpt[20].count} | 平均報酬率: ${statsOpt[20].avgRet} | 勝率: ${statsOpt[20].winRate}`);

console.log("\n=================== 🎯 當前符合【優化策略 C】之台股標的 ===================");
if (currentMatchingStocksOpt.length === 0) {
  console.log("今日無符合此優化訊號之標的。");
} else {
  currentMatchingStocksOpt.forEach(s => {
    console.log(`[${s.id} ${s.name}] 收盤: ${s.price} 元 | 漲跌幅: ${s.change}%`);
    console.log(`   └ 前一日 ATR壓縮度: ${s.atrRatio} | 今日單日放量: ${s.volRatio}`);
    console.log(`   └ 今日法人 ─ 外資: ${s.foreignNetBuy} 張 | 投信: ${s.trustDays} 張`);
  });
}
console.log("=========================================================");
