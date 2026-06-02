const fs = require('fs');
const vm = require('vm');

// Read data.js and stock-dashboard.js
let dataCode = fs.readFileSync('c:/GoogleAntigravity/2026Trading1/data.js', 'utf8');
let dashboardCode = fs.readFileSync('c:/GoogleAntigravity/2026Trading1/stock-dashboard.js', 'utf8');

// Replace const declarations with global assignments so vm context can access them
dataCode = dataCode.replace('const rulesConfig =', 'rulesConfig =');
dataCode = dataCode.replace('const mockStocks =', 'mockStocks =');

// Let's also do a few replacements in dashboardCode if needed
dashboardCode = dashboardCode.replace('function calculateSupertrend', 'global.calculateSupertrend = function');
dashboardCode = dashboardCode.replace('function calculateTrendlineAt', 'global.calculateTrendlineAt = function');
dashboardCode = dashboardCode.replace('function calculateVolumeMA', 'global.calculateVolumeMA = function');
dashboardCode = dashboardCode.replace('function calculateSMA', 'global.calculateSMA = function');

const context = {
  window: {},
  document: {
    getElementById: (id) => ({
      value: '0',
      checked: false
    })
  },
  console: console,
  Math: Math,
  parseFloat: parseFloat,
  parseInt: parseInt,
  setTimeout: setTimeout,
  setInterval: setInterval,
  global: {}
};
context.window = context;
context.global = context;

vm.createContext(context);
// Run dataCode to populate mockStocks
vm.runInContext(dataCode, context);
// Run dashboardCode to populate functions
vm.runInContext(dashboardCode, context);

console.log('Total mockStocks:', context.mockStocks.length);
console.log('Has calculateSupertrend:', typeof context.calculateSupertrend);

const mockStocks = context.mockStocks;

function runSim(p) {
  let passed = [];
  mockStocks.forEach(s => {
    let failedConditions = [];
    let score = 0;
    
    if (s.kline && s.kline.length >= 60) {
      const candles = s.kline.map(d => ({
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

      // 1. Supertrend
      const stData = context.calculateSupertrend(candles, 10, 3);
      let isStBull = false;
      let isAboveSt = false;
      if (stData.length > 0) {
        const currSt = stData[stData.length - 1];
        isStBull = currSt && currSt.trend === 1;
        isAboveSt = currSt && price > currSt.value;
      }

      // 2. MA Arrangement
      const ma20Arr = context.calculateSMA(candles, 20);
      const ma60Arr = context.calculateSMA(candles, 60);
      const m20 = ma20Arr.find(m => m.time === curr.time);
      const m60 = ma60Arr.find(m => m.time === curr.time);
      const isMaAlign = m20 && m60 && m20.value > m60.value;

      // 3. Trendline Break
      const tl = context.calculateTrendlineAt(candles, t);
      let isBreak = false;
      let isPullback = false;
      if (tl && tl.value !== null) {
        isBreak = price > tl.value && parseFloat(candles[t - 1].close) <= tl.prevValue;
        isPullback = price >= tl.value && price <= tl.value * 1.03 && parseFloat(candles[t - 1].close) > tl.prevValue;
      }

      // 4. Volume Ratio
      const vma = context.calculateVolumeMA(candles, 20);
      const vmaVal = vma[t];
      const isVolLarge = vmaVal > 0 && vol > vmaVal * 1.5;

      const isInstBuy = (s.trustDays && s.trustDays > 0) || (s.foreignNetBuy && s.foreignNetBuy > 0) || (s.dealerDays && s.dealerDays > 0);

      if (isStBull) score += 25;
      if (isMaAlign) score += 15;
      if (isBreak) score += 25;
      if (isVolLarge) score += 15;
      if (isAboveSt) score += 10;
      if (isInstBuy) score += 10;

      if (p.stBull && !isStBull) failedConditions.push('Supertrend非多頭');
      if (p.priceAboveSt && !isAboveSt) failedConditions.push('價格未在Supertrend上方');
      if (p.maAlignment && !isMaAlign) failedConditions.push('MA20未大於MA60');
      if (p.trendlineBreak && !isBreak) failedConditions.push('下行趨勢線未突破');
      if (p.trendlinePullback && !isPullback) failedConditions.push('未完成突破回踩');
    } else {
      if (p.stBull || p.priceAboveSt || p.maAlignment || p.trendlineBreak || p.trendlinePullback) {
        failedConditions.push('K線長度不足');
      }
    }

    if (s.trustDays != null && s.trustDays < p.trustDays) failedConditions.push('投信買超不足');
    if (s.foreignNetBuy != null && s.foreignNetBuy < p.foreignNetBuyLimit) failedConditions.push('外資買超不足');
    if (s.dealerDays != null && s.dealerDays < p.dealerNetBuyLimit) failedConditions.push('自營買超不足');
    if (s.volRatio != null && s.volRatio < p.volRatio) failedConditions.push('量能比不足');
    if (s.turnover != null && s.turnover < p.turnover) failedConditions.push('週轉率不足');
    if (s.marketCap != null && s.marketCap < p.mktCap) failedConditions.push('市值不足');
    if (s.dailyVol != null && s.dailyVol < p.dailyVol) failedConditions.push('日均量不足');

    s.dynamicScore = score;
    s.failedConditions = failedConditions;

    // Use Math.max(60, p.minScore) because that's what app.js does!
    if (s.dynamicScore >= Math.max(60, p.minScore) && failedConditions.length === 0 && s.dist52W <= p.dist52W && (!p.closeHigh || s.closeToHigh)) {
      passed.push(s);
    }
  });

  return passed;
}

// Sweep values to target between 5 and 15 stocks.
// Let's run a sweep on the key parameters
const results = [];
for (let score of [60]) {
  for (let volRatio of [1.5, 1.2, 1.0, 0.8, 0.6, 0]) {
    for (let turnover of [2.0, 1.5, 1.0, 0.5, 0.2, 0]) {
      for (let dailyVol of [2000, 1500, 1000, 500, 0]) {
        for (let trustDays of [10, 5, 0]) {
          for (let foreignDays of [10, 5, 0]) {
            for (let dealerDays of [10, 5, 0]) {
              const p = {
                stBull: false,
                priceAboveSt: false,
                maAlignment: false,
                trendlineBreak: false,
                trendlinePullback: false,
                trustDays: trustDays,
                foreignNetBuyLimit: foreignDays,
                dealerNetBuyLimit: dealerDays,
                volRatio: volRatio,
                turnover: turnover,
                mktCap: 50,
                dailyVol: dailyVol,
                dist52W: 15,
                closeHigh: true,
                minScore: score
              };
              const matches = runSim(p);
              if (matches.length >= 5 && matches.length <= 15) {
                results.push({ p, count: matches.length });
              }
            }
          }
        }
      }
    }
  }
}

console.log('Found combinations:', results.length);
// Sort by closest to 8 targets, then more conservative parameters (higher values preferred if count matches)
results.sort((a, b) => {
  const diffA = Math.abs(a.count - 8);
  const diffB = Math.abs(b.count - 8);
  if (diffA !== diffB) return diffA - diffB;
  // Prefer higher parameters if same diff
  return (b.p.volRatio + b.p.turnover/2 + b.p.dailyVol/1000 + b.p.trustDays/10) - (a.p.volRatio + a.p.turnover/2 + a.p.dailyVol/1000 + a.p.trustDays/10);
});

results.slice(0, 15).forEach((r, i) => {
  console.log(`Rank ${i+1}: Count = ${r.count}`);
  console.log(`  Parameters: volRatio=${r.p.volRatio}, turnover=${r.p.turnover}%, dailyVol=${r.p.dailyVol}, trust=${r.p.trustDays}, foreign=${r.p.foreignNetBuyLimit}, dealer=${r.p.dealerNetBuyLimit}`);
});
