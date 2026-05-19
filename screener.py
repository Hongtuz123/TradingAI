import requests
import pandas as pd
import json
import time
import yfinance as yf

# =====================================================
# 自選觀察名單（一定會被納入，不受成交量門檻限制）
# =====================================================
WATCHLIST = [
    {'Code': '3030', 'Name': '德律',   'market': 'TSE'},
    {'Code': '2360', 'Name': '致茂',   'market': 'TSE'},
    {'Code': '6788', 'Name': '華景電', 'market': 'OTC'},
    {'Code': '2330', 'Name': '台積電', 'market': 'TSE'},
    {'Code': '2317', 'Name': '鴻海',   'market': 'TSE'},
    {'Code': '3231', 'Name': '緯創',   'market': 'TSE'},
    {'Code': '3017', 'Name': '奇鋐',   'market': 'TSE'},
    {'Code': '2382', 'Name': '廣達',   'market': 'TSE'},
]

def get_top_stocks(limit=80):
    """從 TWSE/OTC OpenAPI 抓取今日市場資料，回傳股票池"""
    all_listed = {}

    # TWSE 上市
    try:
        res = requests.get(
            'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
            timeout=10
        )
        if res.status_code == 200:
            for r in res.json():
                if r['Code'].isdigit() and len(r['Code']) == 4:
                    r['market'] = 'TSE'
                    all_listed[r['Code']] = r
    except Exception as e:
        print(f'TWSE 抓取失敗: {e}')

    # OTC 上櫃
    try:
        res = requests.get(
            'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',
            timeout=10
        )
        if res.status_code == 200:
            for r in res.json():
                code = r.get('SecuritiesCompanyCode') or r.get('Code')
                if code and code.isdigit() and len(code) == 4:
                    vol  = r.get('Volume') or r.get('TradeVolume') or 0
                    name = r.get('CompanyName') or r.get('Name')
                    close = r.get('Close') or r.get('ClosingPrice')
                    change = r.get('Change') or ''
                    all_listed[code] = {
                        'Code': code, 'Name': name, 'TradeVolume': vol,
                        'ClosingPrice': close, 'Change': change, 'market': 'OTC'
                    }
    except Exception as e:
        print(f'OTC 抓取失敗: {e}')

    result_pool = {}

    # 1. 自選股優先納入
    for w in WATCHLIST:
        code = w['Code']
        if code in all_listed:
            result_pool[code] = all_listed[code]
        else:
            result_pool[code] = {
                'Code': code, 'Name': w['Name'],
                'TradeVolume': 0, 'market': w['market']
            }

    # 2. 成交量前 N 名補足
    sorted_stocks = sorted(
        all_listed.values(),
        key=lambda x: pd.to_numeric(x.get('TradeVolume', 0), errors='coerce') or 0,
        reverse=True
    )
    for s in sorted_stocks:
        if len(result_pool) >= limit + len(WATCHLIST):
            break
        if s['Code'] not in result_pool:
            result_pool[s['Code']] = s

    print(f'合計股票池：{len(result_pool)} 檔')
    return list(result_pool.values())


def get_historical_candles(symbol, market='TSE', days=250):
    """
    使用 yfinance 取得歷史 OHLCV（日線）
    台股代號自動附加 .TW（上市）或 .TWO（上櫃）
    """
    suffix = '.TWO' if market == 'OTC' else '.TW'
    yf_symbol = f"{symbol}{suffix}"
    try:
        ticker = yf.Ticker(yf_symbol)
        hist = ticker.history(period=f"{days}d", interval='1d')
        if hist.empty:
            return []
        candles = []
        for dt, row in hist.iterrows():
            candles.append({
                'date': dt.strftime('%Y-%m-%d'),
                'open':   round(float(row['Open']),  2),
                'high':   round(float(row['High']),  2),
                'low':    round(float(row['Low']),   2),
                'close':  round(float(row['Close']), 2),
                'volume': int(row['Volume']),
            })
        return candles
    except Exception as e:
        print(f'  [yfinance] {yf_symbol} 抓取失敗: {e}')
        return []


def calc_indicators(df):
    """計算常用技術指標，回傳附加欄位的 DataFrame"""
    df = df.sort_values('date').reset_index(drop=True)
    for col in ['close', 'high', 'low', 'volume', 'open']:
        df[col] = pd.to_numeric(df[col])

    # 均線
    df['ma5']      = df['close'].rolling(5,  min_periods=1).mean()
    df['ma20']     = df['close'].rolling(20, min_periods=1).mean()
    df['ma60']     = df['close'].rolling(60, min_periods=1).mean()
    df['vol_ma20'] = df['volume'].rolling(20, min_periods=1).mean()

    # 20MA 走升（今日 ma20 > 昨日 ma20）
    df['ma20_rising'] = df['ma20'] > df['ma20'].shift(1)

    # RSI(14)
    delta = df['close'].diff()
    gain  = delta.where(delta > 0, 0).rolling(window=14, min_periods=1).mean()
    loss  = (-delta.where(delta < 0, 0)).rolling(window=14, min_periods=1).mean()
    rs    = gain / (loss + 1e-9)
    df['rsi14'] = 100 - (100 / (1 + rs))

    # MACD (12/26/9)
    exp1        = df['close'].ewm(span=12, adjust=False).mean()
    exp2        = df['close'].ewm(span=26, adjust=False).mean()
    df['macd']  = exp1 - exp2
    df['signal_line'] = df['macd'].ewm(span=9, adjust=False).mean()
    df['hist']  = df['macd'] - df['signal_line']

    # ATR(14)
    df['prev_close'] = df['close'].shift(1)
    df['tr'] = pd.concat([
        df['high'] - df['low'],
        (df['high'] - df['prev_close']).abs(),
        (df['low']  - df['prev_close']).abs()
    ], axis=1).max(axis=1)
    df['atr14'] = df['tr'].rolling(14, min_periods=1).mean()

    # 布林通道 (20, 2σ)
    df['bb_mid']   = df['close'].rolling(20, min_periods=1).mean()
    df['bb_std']   = df['close'].rolling(20, min_periods=1).std(ddof=0)
    df['bb_upper'] = df['bb_mid'] + 2 * df['bb_std']
    df['bb_lower'] = df['bb_mid'] - 2 * df['bb_std']

    # 52週高點
    df['high_52w'] = df['close'].rolling(250, min_periods=1).max()

    return df


def classify_tech_type(latest, prev, close, vol):
    """
    技術型態分類（優先級：A > C > B > D）
    A = 突破型：收盤站上近20日新高 + 量能放大
    B = 均線多頭：5MA > 20MA > 60MA 且股價 > 5MA
    C = 剛轉強：MACD 柱由負轉正 且 RSI 從 ≤50 突破 50
    D = 強勢回檔：股價 > 20MA 但量能偏低（回檔整理）
    """
    recent_high = latest.get('recent_high', close) if hasattr(latest, 'get') else latest['recent_high'] if 'recent_high' in latest else close

    # A 型優先級最高
    if close >= recent_high and vol > latest['vol_ma20'] * 1.5:
        return 'A'
    # C 型次之
    elif prev['hist'] <= 0 and latest['hist'] > 0 and prev['rsi14'] <= 50 and latest['rsi14'] > 50:
        return 'C'
    # B 型
    elif latest['ma5'] > latest['ma20'] > latest['ma60'] and close > latest['ma5']:
        return 'B'
    # D 型（最低優先級）
    elif close > latest['ma20'] and vol < latest['vol_ma20']:
        return 'D'
    return 'none'


def run_screener():
    print("抓取熱門標的清單...")
    top_stocks = get_top_stocks(limit=30)
    results = []
    print(f"開始處理 {len(top_stocks)} 檔標的歷史資料...")

    for idx, s in enumerate(top_stocks):
        symbol = s['Code']
        name   = s.get('Name', symbol)
        market = s.get('market', 'TSE')
        print(f"[{idx+1}/{len(top_stocks)}] {symbol} {name} ({market})")

        candles = get_historical_candles(symbol, market=market, days=250)
        if len(candles) < 20:
            print(f"  資料不足，跳過")
            continue

        df = pd.DataFrame(candles)
        df = calc_indicators(df)
        latest = df.iloc[-1]
        prev   = df.iloc[-2]

        # 優先用 OpenAPI 的即時收盤價
        openapi_price = s.get('ClosingPrice') or s.get('Close')
        try:
            close = float(openapi_price) if openapi_price and str(openapi_price).replace('.', '').isdigit() else float(latest['close'])
        except Exception:
            close = float(latest['close'])

        vol         = int(latest['volume'])
        vol_ma20    = float(latest['vol_ma20'])
        vol_ratio   = round(vol / vol_ma20, 2) if vol_ma20 > 0 else 0.0
        recent_high = float(df['close'].tail(20).max())

        # 將 recent_high 加入 latest 供分類函式使用
        latest_dict = latest.to_dict()
        latest_dict['recent_high'] = recent_high

        tech_type = classify_tech_type(latest_dict, prev, close, vol)

        ma_bull   = bool(close > latest['ma20'] > latest['ma60'])
        dist_52w  = round(((float(latest['high_52w']) - close) / float(latest['high_52w'])) * 100, 1) if float(latest['high_52w']) > 0 else 0.0
        close_high = bool((close - float(latest['low'])) / (float(latest['high']) - float(latest['low']) + 0.0001) > 0.8)
        ma20_rising = bool(latest['ma20_rising'])

        # 漲跌幅
        raw_change = str(s.get('Change', '') or '')
        try:
            change_num = float(raw_change.replace('+', '').replace('X', '').replace('x', '').strip() or '0')
            if raw_change.startswith('-'):
                change_num = -abs(change_num)
        except Exception:
            change_num = 0.0

        # 真實技術指標值（供前端顯示）
        rsi_val  = round(float(latest['rsi14']), 2)
        macd_val = round(float(latest['macd']), 4)
        atr_val  = round(float(latest['atr14']), 2)
        bb_upper = round(float(latest['bb_upper']), 2)
        bb_lower = round(float(latest['bb_lower']), 2)
        ma5_val  = round(float(latest['ma5']), 2)
        ma20_val = round(float(latest['ma20']), 2)
        ma60_val = round(float(latest['ma60']), 2)

        results.append({
            # 基本資訊
            "id": symbol, "name": name, "market": market,
            "price": round(close, 2), "change": round(change_num, 2),
            # 基本面（目前用固定值，未來可接真實 API）
            "epsYoY": 20, "revYoY": 25, "roe": 12,
            "grossMargin": 30, "debtRatio": 45,
            # 籌碼（目前用固定值，未來可接真實 API）
            "trustDays": 3, "foreignBuy": True,
            # 技術面（真實計算）
            "volRatio": vol_ratio, "turnover": 5.0,
            "marketCap": 200, "dailyVol": vol // 1000,
            "type": tech_type,
            "maBull": ma_bull,
            "ma20Rising": ma20_rising,
            "closeToHigh": close_high,
            "dist52W": dist_52w,
            # 指標值（供前端戰情板顯示）
            "rsi14": rsi_val,
            "macd":  macd_val,
            "atr14": atr_val,
            "bbUpper": bb_upper,
            "bbLower": bb_lower,
            "ma5":  ma5_val,
            "ma20": ma20_val,
            "ma60": ma60_val,
            # 黑名單（預設空）
            "blacklist": [],
            # K線（最近120根，已確保升序）
            "kline": sorted(candles, key=lambda x: x['date'])[-120:]
        })

        time.sleep(0.3)  # 避免 yfinance rate limit

    # ============================================
    # 輸出 data.js（供前端直接引入）
    # ============================================
    now_str = pd.Timestamp.now().strftime('%Y-%m-%d %H:%M:%S')
    js_content = f"""// 由 yfinance 產生之真實資料 — {now_str}
const marketData = {{
  twii_above_60ma: true,
  otc_above_60ma: true,
  vol_above_20ma: true,
  lastUpdate: '{now_str}'
}};

const mockStocks = {json.dumps(results, ensure_ascii=False, indent=2)};

// 評分邏輯 (滿分 12 分，新增 20MA 走升)
function calculateScore(stock) {{
  let score = 0;
  if (stock.revYoY     > 20) score += 1;
  if (stock.epsYoY     > 15) score += 1;
  if (stock.roe        > 10) score += 1;
  if (stock.dailyVol   > 2000) score += 1;
  if (stock.marketCap  > 50) score += 1;
  if (stock.trustDays  >= 3) score += 1;
  if (stock.foreignBuy) score += 1;
  if (stock.maBull)    score += 1;
  if (stock.ma20Rising) score += 1;
  if (stock.volRatio   > 1.5) score += 1;
  if (stock.closeToHigh) score += 1;
  if (stock.dist52W    < 15) score += 1;
  return score;
}}

mockStocks.forEach(s => s.score = calculateScore(s));
"""

    with open('data.js', 'w', encoding='utf-8') as f:
        f.write(js_content)

    print(f"執行完畢！共產出 {len(results)} 檔，已覆寫 data.js")


if __name__ == "__main__":
    run_screener()
