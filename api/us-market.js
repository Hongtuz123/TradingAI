// Vercel Serverless Function: 即時獲取美股主要指數 (費半, 那指, 羅素, 道瓊, S&P 500, VIX)
export default async function handler(req, res) {
  // 設定 CORS 與快取標頭 (Vercel Edge 節點快取 60 秒)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const indexConfigs = [
    { symbol: '^SOX', label: '費半 SOX' },
    { symbol: '^NDX', label: '那斯達克 100' },
    { symbol: '^RUT', label: '羅素 2000' },
    { symbol: '^DJI', label: '道瓊 DJI' },
    { symbol: '^GSPC', label: 'S&P 500' },
    { symbol: '^VIX', label: 'VIX 恐慌指數' }
  ];

  try {
    const fetchPromises = indexConfigs.map(async (item) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(item.symbol)}?interval=1d&range=5d`;
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const meta = data?.chart?.result?.[0]?.meta;
        if (!meta) throw new Error('No meta');

        const curPrice = meta.regularMarketPrice !== undefined ? Number(meta.regularMarketPrice) : null;
        let pctChg = meta.regularMarketChangePercent !== undefined ? Number(meta.regularMarketChangePercent) : null;
        
        // 若缺少 percent 但有 prevClose，手動計算
        if (pctChg === null && curPrice !== null && meta.chartPreviousClose) {
          pctChg = ((curPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100;
        }

        return {
          label: item.label,
          symbol: item.symbol,
          close: curPrice !== null ? Math.round(curPrice * 100) / 100 : null,
          pct_chg: pctChg !== null ? Math.round(pctChg * 100) / 100 : null,
          volume: meta.regularMarketVolume || 0,
          vol_level: '普通',
          vol_ratio: 1.0,
          updated_at: new Date().toISOString()
        };
      } catch (err) {
        console.warn(`[US Market] Failed to fetch ${item.symbol}:`, err.message);
        return {
          label: item.label,
          symbol: item.symbol,
          close: null,
          pct_chg: null,
          volume: null,
          vol_level: '普通',
          vol_ratio: 1.0,
          error: err.message
        };
      }
    });

    const results = await Promise.all(fetchPromises);
    const validResults = results.filter(r => r.close !== null);

    const nowTaipei = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });

    return res.status(200).json({
      success: true,
      timestamp: nowTaipei,
      count: validResults.length,
      data: results
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Server error'
    });
  }
}
