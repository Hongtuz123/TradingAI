// 由 Fugle API 產生之真實資料
const marketData = {
  twii_above_60ma: true,
  otc_above_60ma: true,
  vol_above_20ma: true,
  lastUpdate: '2026-05-12 13:07:56'
};

const mockStocks = [];

// 評分邏輯 (滿分11分)
function calculateScore(stock) {
  let score = 0;
  if (stock.revYoY > 20) score += 1;
  if (stock.epsYoY > 15) score += 1;
  if (stock.roe > 10) score += 1;
  if (stock.dailyVol > 2000) score += 1;
  if (stock.marketCap > 50) score += 1;
  if (stock.trustDays >= 3) score += 1;
  if (stock.foreignBuy) score += 1;
  if (stock.maBull) score += 1;
  if (stock.volRatio > 1.5) score += 1;
  if (stock.closeToHigh) score += 1;
  if (stock.dist52W < 15) score += 1;
  return score;
}

mockStocks.forEach(s => s.score = calculateScore(s));
