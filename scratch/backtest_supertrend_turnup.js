const fs = require('fs');
const path = require('path');

// 載入 mockStocks
console.log('正在載入數據...');
const dataContent = fs.readFileSync(path.join(__dirname, '../data.js'), 'utf8');
const sandbox = {};
const fn = new Function('sandbox', dataContent + '\nreturn mockStocks;');
const mockStocks = fn(sandbox);

console.log(`成功載入 ${mockStocks.length} 檔標的資料。`);

// 輔助函數：計算 ATR
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

const backtestResults = [];
let totalTriggers = 0;

mockStocks.forEach(stock => {
  if (!stock.kline || stock.kline.length < 50) return;
  
  const kline = stock.kline;
  const len = kline.length;
  const st = calculateSupertrend(kline, 10, 3);
  
  for (let i = 11; i < len; i++) {
    const stCurr = st[i];
    const stPrev = st[i - 1];
    
    // 條件：當天日線從空轉多 (Trend 從 -1 變 1)
    const stTurnUp = stCurr && stPrev && stCurr.trend === 1 && stPrev.trend === -1;
    
    if (stTurnUp) {
      totalTriggers++;
      const entryPrice = parseFloat(kline[i].close);
      const isLastDay = (i === len - 1);
      
      if (!isLastDay) {
        const ret5 = i + 5 < len ? (parseFloat(kline[i + 5].close) - entryPrice) / entryPrice : null;
        const ret10 = i + 10 < len ? (parseFloat(kline[i + 10].close) - entryPrice) / entryPrice : null;
        const ret20 = i + 20 < len ? (parseFloat(kline[i + 20].close) - entryPrice) / entryPrice : null;
        
        backtestResults.push({
          id: stock.id,
          name: stock.name,
          date: kline[i].date || kline[i].time,
          ret5, ret10, ret20
        });
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

console.log("\n=================== 📊 策略：單純 Supertrend (10, 3) 從空轉多第一天 ===================");
console.log(`總觸發訊號次數: ${totalTriggers} 次`);
console.log(`持有  5 天 ── 樣本數: ${stats[5].count} | 平均報酬率: ${stats[5].avgRet} | 勝率: ${stats[5].winRate}`);
console.log(`持有 10 天 ─ 樣本數: ${stats[10].count} | 平均報酬率: ${stats[10].avgRet} | 勝率: ${stats[10].winRate}`);
console.log(`持有 20 天 ─ 樣本數: ${stats[20].count} | 平均報酬率: ${stats[20].avgRet} | 勝率: ${stats[20].winRate}`);
console.log("==================================================================================");
