const fs = require('fs');

global.window = global;
global.document = {
  readyState: 'complete',
  addEventListener: () => {},
  getElementById: () => ({ addEventListener: () => {}, style: {} })
};

// Read data.js and stock-dashboard.js
let dataCode = fs.readFileSync('c:/GoogleAntigravity/2026Trading1/data.js', 'utf8');
let dashboardCode = fs.readFileSync('c:/GoogleAntigravity/2026Trading1/stock-dashboard.js', 'utf8');

dataCode = dataCode.replace('const rulesConfig =', 'global.rulesConfig =');
dataCode = dataCode.replace('const mockStocks =', 'global.mockStocks =');

eval(dataCode);
eval(dashboardCode);

const precomputed = global.mockStocks.map(s => {
  let isStBull = false;
  let isAboveSt = false;
  let isMaAlign = false;
  let isBreak = false;
  let isPullback = false;
  let isVolLarge = false;
  let isInstBuy = (s.trustDays && s.trustDays > 0) || (s.foreignNetBuy && s.foreignNetBuy > 0) || (s.dealerDays && s.dealerDays > 0);

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

    const stData = calculateSupertrend(candles, 10, 3);
    if (stData.length > 0) {
      const currSt = stData[stData.length - 1];
      isStBull = currSt && currSt.trend === 1;
      isAboveSt = currSt && price > currSt.value;
    }

    const ma20Arr = calculateSMA(candles, 20);
    const ma60Arr = calculateSMA(candles, 60);
    const m20 = ma20Arr.find(m => m.time === curr.time);
    const m60 = ma60Arr.find(m => m.time === curr.time);
    isMaAlign = m20 && m60 && m20.value > m60.value;

    const tl = calculateTrendlineAt(candles, t);
    if (tl && tl.value !== null) {
      isBreak = price > tl.value && parseFloat(candles[t - 1].close) <= tl.prevValue;
      isPullback = price >= tl.value && price <= tl.value * 1.03 && parseFloat(candles[t - 1].close) > tl.prevValue;
    }

    const vma = calculateVolumeMA(candles, 20);
    const vmaVal = vma[t];
    isVolLarge = vmaVal > 0 && vol > vmaVal * 1.5;
  }

  let score = 0;
  if (isStBull) score += 25;
  if (isMaAlign) score += 15;
  if (isBreak) score += 25;
  if (isVolLarge) score += 15;
  if (isAboveSt) score += 10;
  if (isInstBuy) score += 10;

  return {
    id: s.id,
    name: s.name,
    dynamicScore: score,
    trustDays: s.trustDays,
    foreignNetBuy: s.foreignNetBuy,
    dealerDays: s.dealerDays,
    volRatio: s.volRatio,
    turnover: s.turnover,
    marketCap: s.marketCap,
    dailyVol: s.dailyVol,
    dist52W: s.dist52W,
    closeToHigh: s.closeToHigh,
    isStBull,
    isAboveSt,
    isMaAlign,
    isBreak,
    isPullback,
    isVolLarge,
    isInstBuy
  };
});

function runSimCached(p) {
  let passed = [];
  precomputed.forEach(s => {
    let failedConditions = [];
    if (p.stBull && !s.isStBull) failedConditions.push('Supertrend非多頭');
    if (p.priceAboveSt && !s.isAboveSt) failedConditions.push('價格未在Supertrend上方');
    if (p.maAlignment && !s.isMaAlign) failedConditions.push('MA20未大於MA60');
    if (p.trendlineBreak && !s.isBreak) failedConditions.push('下行趨勢線未突破');
    if (p.trendlinePullback && !s.isPullback) failedConditions.push('未完成突破回踩');

    if (s.trustDays != null && s.trustDays < p.trustDays) failedConditions.push('投信買超不足');
    if (s.foreignNetBuy != null && s.foreignNetBuy < p.foreignNetBuyLimit) failedConditions.push('外資買超不足');
    if (s.dealerDays != null && s.dealerDays < p.dealerNetBuyLimit) failedConditions.push('自營買超不足');
    if (s.volRatio != null && s.volRatio < p.volRatio) failedConditions.push('量能比不足');
    if (s.turnover != null && s.turnover < p.turnover) failedConditions.push('週轉率不足');
    if (s.marketCap != null && s.marketCap < p.mktCap) failedConditions.push('市值不足');
    if (s.dailyVol != null && s.dailyVol < p.dailyVol) failedConditions.push('日均量不足');

    if (s.dynamicScore >= Math.max(60, p.minScore) && failedConditions.length === 0 && s.dist52W <= p.dist52W && (!p.closeHigh || s.closeToHigh)) {
      passed.push(s);
    }
  });
  return passed;
}

// Test target configurations:
const testConfigs = [
  { volRatio: 0.8, turnover: 0.5, dailyVol: 1000, trustDays: 0, foreignNetBuyLimit: 0, dealerNetBuyLimit: 0, minScore: 60, closeHigh: true },
  { volRatio: 1.0, turnover: 0.5, dailyVol: 1000, trustDays: 0, foreignNetBuyLimit: 0, dealerNetBuyLimit: 0, minScore: 60, closeHigh: true },
  { volRatio: 0.8, turnover: 1.0, dailyVol: 1000, trustDays: 0, foreignNetBuyLimit: 0, dealerNetBuyLimit: 0, minScore: 60, closeHigh: true },
  { volRatio: 0.8, turnover: 0.5, dailyVol: 1000, trustDays: 0, foreignNetBuyLimit: 0, dealerNetBuyLimit: 0, minScore: 60, closeHigh: false },
  { volRatio: 1.0, turnover: 1.0, dailyVol: 1000, trustDays: 0, foreignNetBuyLimit: 0, dealerNetBuyLimit: 0, minScore: 60, closeHigh: false }
];

testConfigs.forEach((c, idx) => {
  const p = {
    stBull: false,
    priceAboveSt: false,
    maAlignment: false,
    trendlineBreak: false,
    trendlinePullback: false,
    dist52W: 15,
    mktCap: 50,
    ...c
  };
  const list = runSimCached(p);
  console.log(`Config ${idx + 1}: matches = ${list.length}`);
  console.log(`  Params: volRatio=${c.volRatio}, turnover=${c.turnover}%, dailyVol=${c.dailyVol}, trust=${c.trustDays}, closeHigh=${c.closeHigh}`);
  console.log(`  Stocks: ${list.map(s => `${s.id} ${s.name} (Score: ${s.dynamicScore})`).join(', ')}`);
});

process.exit(0);
