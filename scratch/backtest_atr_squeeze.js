const fs = require('fs');
const path = require('path');

// 載入 mockStocks
const dataContent = fs.readFileSync(path.join(__dirname, '../data.js'), 'utf8');
// 載入 mockStocks
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

// 輔助函數：計算 ATR
function calculateATR(data, period = 14) {
  const tr = new Array(data.length).fill(0);
  const atr = new Array(data.length).fill(null);
  
  for (let i = 0; i < data.length; i++) {
    const high = parseFloat(data[i].high);
    const low = parseFloat(data[i].low);
    const close = parseFloat(data[i].close);
    
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
  
  // ATR 用 TR 的簡單平均 (SMA) 或是滑動平均，這裡使用 SMA 簡化
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += tr[i];
    if (i >= period - 1) {
      if (i >= period) {
        sum -= tr[i - period];
      }
      atr[i] = sum / period;
    }
  }
  
  return { tr, atr };
}

const backtestResults = [];
const currentMatchingStocks = [];

const backtestResultsStrict = [];
const currentMatchingStocksStrict = [];

mockStocks.forEach(stock => {
  if (!stock.kline || stock.kline.length < 100) return;
  
  const kline = stock.kline;
  const len = kline.length;
  
  const ma20 = calculateSMA(kline, 20, 'close');
  const { atr } = calculateATR(kline, 14);
  
  for (let i = 60; i < len; i++) {
    const close = parseFloat(kline[i].close);
    
    // 條件 1：股價在 20MA 上方 10 天
    let above20MA10Days = true;
    let maxClose = -Infinity;
    let minClose = Infinity;
    let maxHigh = -Infinity;
    let minLow = Infinity;
    
    for (let j = 0; j < 10; j++) {
      const idx = i - j;
      const c = parseFloat(kline[idx].close);
      const h = parseFloat(kline[idx].high);
      const l = parseFloat(kline[idx].low);
      const ma = ma20[idx];
      if (ma === null || c <= ma) {
        above20MA10Days = false;
        break;
      }
      if (c > maxClose) maxClose = c;
      if (c < minClose) minClose = c;
      if (h > maxHigh) maxHigh = h;
      if (l < minLow) minLow = l;
    }
    if (!above20MA10Days) continue;
    
    // 條件 2：波動幅度 (ATR) 縮小到近期的 30% 內
    let maxAtr60 = 0;
    let hasValidAtr = true;
    for (let j = 1; j <= 60; j++) {
      const prevAtr = atr[i - j];
      if (prevAtr === null) {
        hasValidAtr = false;
        break;
      }
      if (prevAtr > maxAtr60) {
        maxAtr60 = prevAtr;
      }
    }
    if (!hasValidAtr || maxAtr60 === 0) continue;
    
    const currAtr = atr[i];
    if (currAtr === null || currAtr > maxAtr60 * 0.3) continue;
    
    // 額外條件：嚴格橫盤 (近 10 天高低點極差小於等於 6%)
    const rangePct = (maxHigh - minLow) / minLow;
    const isStrictConsolidation = rangePct <= 0.06;
    
    const isLastDay = (i === len - 1);
    const itemData = {
      id: stock.id,
      name: stock.name,
      price: close,
      change: stock.change,
      atrRatio: (currAtr / maxAtr60 * 100).toFixed(1) + '%',
      rangePct: (rangePct * 100).toFixed(1) + '%'
    };
    
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
    
    if (isLastDay) {
      currentMatchingStocks.push(itemData);
      if (isStrictConsolidation) {
        currentMatchingStocksStrict.push(itemData);
      }
    } else {
      backtestResults.push(backtestItem);
      if (isStrictConsolidation) {
        backtestResultsStrict.push(backtestItem);
      }
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
const statsStrict = analyzeBacktest(backtestResultsStrict);

console.log("\n=================== 📊 策略 A：20MA上方 + ATR壓縮 30% 內 ===================");
console.log(`總觸發訊號次數: ${backtestResults.length + currentMatchingStocks.length} 次`);
console.log(`持有  5 天 ── 樣本數: ${stats[5].count} | 平均報酬率: ${stats[5].avgRet} | 勝率: ${stats[5].winRate}`);
console.log(`持有 10 天 ─ 樣本數: ${stats[10].count} | 平均報酬率: ${stats[10].avgRet} | 勝率: ${stats[10].winRate}`);
console.log(`持有 20 天 ─ 樣本數: ${stats[20].count} | 平均報酬率: ${stats[20].avgRet} | 勝率: ${stats[20].winRate}`);

console.log("\n=================== 📊 策略 B：策略 A + 近10日震幅 <= 6% (嚴格盤整) ===================");
console.log(`總觸發訊號次數: ${backtestResultsStrict.length + currentMatchingStocksStrict.length} 次`);
console.log(`持有  5 天 ── 樣本數: ${statsStrict[5].count} | 平均報酬率: ${statsStrict[5].avgRet} | 勝率: ${statsStrict[5].winRate}`);
console.log(`持有 10 天 ─ 樣本數: ${statsStrict[10].count} | 平均報酬率: ${statsStrict[10].avgRet} | 勝率: ${statsStrict[10].winRate}`);
console.log(`持有 20 天 ─ 樣本數: ${statsStrict[20].count} | 平均報酬率: ${statsStrict[20].avgRet} | 勝率: ${statsStrict[20].winRate}`);

console.log("\n=================== 🎯 當前符合條件之台股標的 ===================");
if (currentMatchingStocks.length === 0) {
  console.log("今日無符合此壓縮盤整訊號之標的。");
} else {
  currentMatchingStocks.forEach(s => {
    console.log(`[${s.id} ${s.name}] 收盤價: ${s.price} 元 | 漲跌幅: ${s.change}% | ATR壓縮度: ${s.atrRatio}`);
  });
}
console.log("=========================================================");
