// 模擬後端傳來的市場與股票資料
const marketData = {
  twii_above_60ma: true,
  otc_above_60ma: true,
  vol_above_20ma: true,
  lastUpdate: '2026-05-12 14:30:00'
};

// 模擬 50 檔股票池 (包含符合與不符合條件的)
const mockStocks = [
  { id: '2330', name: '台積電', price: 850, change: 1.5, epsYoY: 25, revYoY: 22, roe: 28, grossMargin: 53, debtRatio: 40, trustDays: 5, foreignBuy: true, volRatio: 1.2, turnover: 1.5, marketCap: 220000, dailyVol: 35000, type: 'B', maBull: true, closeToHigh: true, dist52W: 5, blacklist: [] },
  { id: '2317', name: '鴻海', price: 155, change: 2.1, epsYoY: 18, revYoY: 15, roe: 12, grossMargin: 6.5, debtRatio: 55, trustDays: 3, foreignBuy: true, volRatio: 1.6, turnover: 4.2, marketCap: 21000, dailyVol: 80000, type: 'A', maBull: true, closeToHigh: true, dist52W: 2, blacklist: [] },
  { id: '2454', name: '聯發科', price: 1150, change: -1.0, epsYoY: 12, revYoY: 8, roe: 18, grossMargin: 48, debtRatio: 35, trustDays: 0, foreignBuy: false, volRatio: 0.8, turnover: 2.1, marketCap: 18000, dailyVol: 8000, type: 'D', maBull: true, closeToHigh: false, dist52W: 10, blacklist: [] },
  { id: '3231', name: '緯創', price: 115, change: 5.5, epsYoY: 120, revYoY: 45, roe: 15, grossMargin: 8, debtRatio: 65, trustDays: 8, foreignBuy: true, volRatio: 2.5, turnover: 8.5, marketCap: 3300, dailyVol: 120000, type: 'A', maBull: true, closeToHigh: true, dist52W: 1, blacklist: [] },
  { id: '2382', name: '廣達', price: 280, change: 3.2, epsYoY: 85, revYoY: 30, roe: 16, grossMargin: 7.5, debtRatio: 62, trustDays: 4, foreignBuy: true, volRatio: 1.8, turnover: 5.1, marketCap: 10000, dailyVol: 45000, type: 'B', maBull: true, closeToHigh: true, dist52W: 3, blacklist: [] },
  { id: '3008', name: '大立光', price: 2450, change: -2.5, epsYoY: 5, revYoY: -2, roe: 14, grossMargin: 50, debtRatio: 25, trustDays: 0, foreignBuy: false, volRatio: 1.1, turnover: 1.2, marketCap: 3200, dailyVol: 1500, type: 'none', maBull: false, closeToHigh: false, dist52W: 25, blacklist: ['長期橫盤沒量'] },
  { id: '2603', name: '長榮', price: 185, change: 1.2, epsYoY: -50, revYoY: -35, roe: 22, grossMargin: 18, debtRatio: 35, trustDays: 2, foreignBuy: false, volRatio: 0.9, turnover: 2.8, marketCap: 3900, dailyVol: 25000, type: 'C', maBull: true, closeToHigh: false, dist52W: 12, blacklist: ['財報突然轉差'] },
  { id: '3017', name: '奇鋐', price: 620, change: 8.5, epsYoY: 45, revYoY: 35, roe: 24, grossMargin: 22, debtRatio: 52, trustDays: 12, foreignBuy: true, volRatio: 3.2, turnover: 12.5, marketCap: 2300, dailyVol: 32000, type: 'A', maBull: true, closeToHigh: true, dist52W: 0, blacklist: [] },
  { id: '3324', name: '雙鴻', price: 780, change: 4.5, epsYoY: 38, revYoY: 28, roe: 21, grossMargin: 24, debtRatio: 48, trustDays: 5, foreignBuy: true, volRatio: 1.5, turnover: 9.2, marketCap: 680, dailyVol: 18000, type: 'B', maBull: true, closeToHigh: true, dist52W: 4, blacklist: [] },
  { id: '1504', name: '東元', price: 58, change: -4.5, epsYoY: 12, revYoY: 15, roe: 8, grossMargin: 25, debtRatio: 45, trustDays: 0, foreignBuy: false, volRatio: 4.5, turnover: 15.2, marketCap: 1200, dailyVol: 85000, type: 'none', maBull: false, closeToHigh: false, dist52W: 18, blacklist: ['爆量長黑'] }
];

// 擴充假資料到 30 筆
for(let i=11; i<=30; i++) {
  const isGood = Math.random() > 0.4;
  mockStocks.push({
    id: `80${i.toString().padStart(2, '0')}`,
    name: `測試股${i}`,
    price: Math.floor(Math.random() * 200) + 20,
    change: (Math.random() * 10 - 3).toFixed(1),
    epsYoY: isGood ? Math.floor(Math.random() * 50) + 15 : Math.floor(Math.random() * 20) - 10,
    revYoY: isGood ? Math.floor(Math.random() * 40) + 20 : Math.floor(Math.random() * 15) - 5,
    roe: isGood ? Math.floor(Math.random() * 15) + 10 : Math.floor(Math.random() * 9),
    grossMargin: Math.floor(Math.random() * 40) + 10,
    debtRatio: Math.floor(Math.random() * 40) + 30,
    trustDays: isGood ? Math.floor(Math.random() * 8) : 0,
    foreignBuy: isGood,
    volRatio: isGood ? (Math.random() * 2 + 1).toFixed(1) : (Math.random() * 1).toFixed(1),
    turnover: (Math.random() * 8 + 1).toFixed(1),
    marketCap: Math.floor(Math.random() * 200) + 30,
    dailyVol: Math.floor(Math.random() * 15000) + 500,
    type: isGood ? ['A', 'B', 'C', 'D'][Math.floor(Math.random()*4)] : 'none',
    maBull: isGood,
    closeToHigh: isGood,
    dist52W: Math.floor(Math.random() * 30),
    blacklist: isGood ? [] : (Math.random() > 0.5 ? ['長期橫盤沒量'] : [])
  });
}

// 評分邏輯 (滿分11分)
function calculateScore(stock) {
  let score = 0;
  // 基本面 3分
  if (stock.revYoY > 20) score += 1;
  if (stock.epsYoY > 15) score += 1;
  if (stock.roe > 10) score += 1;
  // 流動性 2分
  if (stock.dailyVol > 2000) score += 1;
  if (stock.marketCap > 50) score += 1;
  // 籌碼 2分
  if (stock.trustDays >= 3) score += 1;
  if (stock.foreignBuy) score += 1;
  // 技術面 4分
  if (stock.maBull) score += 1;
  if (stock.volRatio > 1.5) score += 1;
  if (stock.closeToHigh) score += 1;
  if (stock.dist52W < 15) score += 1;
  
  return score;
}

// 計算所有股票的初始評分
mockStocks.forEach(s => s.score = calculateScore(s));
