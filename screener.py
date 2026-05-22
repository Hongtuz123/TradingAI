import requests
import pandas as pd
import json
import time
import yfinance as yf
import os
import csv

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

def format_stock_code(code_str):
    """
    智慧股票代碼補零邏輯 (解決 Excel/CSV 開頭零丟失問題)：
    - 小於 100 補為 4 碼 (例如 50 -> 0050)
    - 100~999 補為 5 碼 (例如 919 -> 00919)
    - 其餘保留原樣
    """
    code_str = str(code_str).strip()
    if code_str.isdigit():
        val = int(code_str)
        if val < 100:
            return f"{val:04d}"
        elif val < 1000:
            return f"00{val}"
    return code_str

def read_stock_list_from_csv(csv_path):
    """從 CSV 讀取 400 隻股票清單，回傳格式化的代碼與名稱列表"""
    stocks = []
    if not os.path.exists(csv_path):
        print(f"❌ 找不到 CSV 檔案：{csv_path}")
        return stocks
        
    try:
        # 使用 utf-8-sig 以處理 Excel 可能產生的 BOM 頭
        with open(csv_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.reader(f)
            header = next(reader, None) # 跳過標題列
            for row in reader:
                if len(row) >= 3:
                    # 股票代碼在第 2 欄 (index 1)，股票名稱在第 3 欄 (index 2)
                    raw_code = row[1].strip()
                    raw_name = row[2].strip()
                    if raw_code:
                        formatted_code = format_stock_code(raw_code)
                        stocks.append({
                            'Code': formatted_code,
                            'Name': raw_name
                        })
    except Exception as e:
        print(f"讀取 CSV 失敗: {e}")
        
    return stocks

def load_all_market_info():
    """從 TWSE/TPEX OpenAPI 抓取今日所有上市櫃股票的基本資訊"""
    all_listed = {}
    
    # TWSE 上市
    try:
        res = requests.get(
            'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
            timeout=10
        )
        if res.status_code == 200:
            for r in res.json():
                if r['Code'].isdigit() and len(r['Code']) >= 4:
                    r['market'] = 'TSE'
                    all_listed[r['Code'].strip()] = r
    except Exception as e:
        print(f'TWSE 抓取失敗: {e}')

    # TPEX 上櫃
    try:
        res = requests.get(
            'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',
            timeout=10
        )
        if res.status_code == 200:
            for r in res.json():
                code = (r.get('SecuritiesCompanyCode') or r.get('Code', '')).strip()
                if code and code.isdigit() and len(code) >= 4:
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
        
    return all_listed



def calc_market_health():
    """計算市場健康度：加權/OTC 是否站上 60MA，大盤量是否 > 20MA"""
    result = {'twii': True, 'otc': True, 'vol': True}
    for symbol_key, label in [('twii', '^TWII'), ('otc', '^TWOII')]:
        try:
            hist = yf.Ticker(label).history(period='120d', interval='1d')
            if len(hist) >= 60:
                ma60 = hist['Close'].rolling(60).mean().iloc[-1]
                latest_close = hist['Close'].iloc[-1]
                result[symbol_key] = bool(latest_close > ma60)
            # 用加權指數的量算 vol > 20MA
            if symbol_key == 'twii' and len(hist) >= 20:
                vol_ma20 = hist['Volume'].rolling(20).mean().iloc[-1]
                latest_vol = hist['Volume'].iloc[-1]
                result['vol'] = bool(latest_vol > vol_ma20)
        except Exception as e:
            print(f'  市場健康度 {label} 計算失敗: {e}')
    return result


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
    print("讀取股票評估清單 CSV...")
    base_dir = os.path.dirname(os.path.abspath(__file__))
    csv_path = os.path.join(base_dir, "股票分析清單.csv")
    csv_stocks = read_stock_list_from_csv(csv_path)
    
    if not csv_stocks:
        print("⚠️ CSV 清單為空或讀取失敗，改用預設 WATCHLIST...")
        csv_stocks = WATCHLIST
        
    print(f"載入 TWSE/TPEX OpenAPI 市場資訊...")
    all_market_info = load_all_market_info()
    
    # 建立 yfinance 代碼與股票資料對照表
    yf_to_stock = {}
    tickers = []
    for s in csv_stocks:
        code = s['Code']
        name = s.get('Name', code)
        
        # 智慧判定市場：OpenAPI 優先，再來以 B 結尾為上櫃，其餘預設上市
        market = 'TSE'
        if code in all_market_info:
            market = all_market_info[code].get('market', 'TSE')
            # 補齊 OpenAPI 欄位
            s.update(all_market_info[code])
        else:
            if code.endswith('B'):
                market = 'OTC'
            else:
                market = 'TSE'
                
        s['market'] = market
        suffix = '.TWO' if market == 'OTC' else '.TW'
        yf_ticker = f"{code}{suffix}"
        yf_to_stock[yf_ticker] = s
        tickers.append(yf_ticker)
        
    results = []
    price_failed_stocks = []
    
    print(f"開始批次下載 {len(tickers)} 檔標的歷史資料 (250天)...")
    if tickers:
        try:
            df_all = yf.download(tickers, period='250d', group_by='ticker', threads=True)
        except Exception as e:
            print(f"❌ 批次下載失敗: {e}")
            df_all = pd.DataFrame()
    else:
        df_all = pd.DataFrame()

    print(f"開始處理下載之歷史資料並計算指標...")
    for idx, (yf_ticker, s) in enumerate(yf_to_stock.items()):
        symbol = s['Code']
        name = s['Name']
        market = s['market']
        
        # 檢查該 ticker 的資料是否存在與完整
        df_stock = pd.DataFrame()
        try:
            if not df_all.empty:
                if isinstance(df_all.columns, pd.MultiIndex):
                    if yf_ticker in df_all.columns.levels[0]:
                        df_stock = df_all[yf_ticker].dropna(subset=['Close'])
                else:
                    df_stock = df_all.dropna(subset=['Close'])
            
            if df_stock.empty or len(df_stock) < 20:
                raise ValueError("歷史資料筆數不足 20 筆或全為 NaN")
                
            candles = []
            for dt, row in df_stock.iterrows():
                candles.append({
                    'date': dt.strftime('%Y-%m-%d'),
                    'open':   round(float(row['Open']),  2),
                    'high':   round(float(row['High']),  2),
                    'low':    round(float(row['Low']),   2),
                    'close':  round(float(row['Close']), 2),
                    'volume': int(row['Volume']),
                })
                
            df = pd.DataFrame(candles)
            df = calc_indicators(df)
            latest = df.iloc[-1]
            prev   = df.iloc[-2]

            # 優先用 OpenAPI 的即時收盤價
            openapi_price = s.get('ClosingPrice') or s.get('Close')
            try:
                close = float(openapi_price) if openapi_price and str(openapi_price).replace('.', '').replace('-', '').isdigit() else float(latest['close'])
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

            # 漲跌幅：以當日 9:00 開盤價為基準計算當前現價的漲跌幅
            try:
                open_price = float(latest['open'])
                if open_price > 0:
                    change_num = round(((close - open_price) / open_price) * 100, 2)
                else:
                    change_num = round(((close - float(prev['close'])) / float(prev['close'])) * 100, 2) if float(prev['close']) > 0 else 0.0
            except Exception:
                change_num = round(((close - float(prev['close'])) / float(prev['close'])) * 100, 2) if float(prev['close']) > 0 else 0.0

            # 真實技術指標值
            rsi_val  = round(float(latest['rsi14']), 2)
            macd_val = round(float(latest['macd']), 4)
            atr_val  = round(float(latest['atr14']), 2)
            bb_upper = round(float(latest['bb_upper']), 2)
            bb_lower = round(float(latest['bb_lower']), 2)
            ma5_val  = round(float(latest['ma5']), 2)
            ma20_val = round(float(latest['ma20']), 2)
            ma60_val = round(float(latest['ma60']), 2)

            results.append({
                "id": symbol, "name": name, "market": market,
                "price": round(close, 2), "change": round(change_num, 2),
                "epsYoY": None, "revYoY": None, "roe": None,
                "grossMargin": None, "debtRatio": None,
                "trustDays": None, "foreignBuy": None,
                "volRatio": vol_ratio, "turnover": None,
                "marketCap": None, "dailyVol": vol // 1000,
                "type": tech_type,
                "maBull": ma_bull,
                "ma20Rising": ma20_rising,
                "closeToHigh": close_high,
                "dist52W": dist_52w,
                "rsi14": rsi_val,
                "macd":  macd_val,
                "atr14": atr_val,
                "bbUpper": bb_upper,
                "bbLower": bb_lower,
                "ma5":  ma5_val,
                "ma20": ma20_val,
                "ma60": ma60_val,
                "blacklist": [],
                "kline": sorted(candles, key=lambda x: x['date'])[-120:]
            })
            
        except Exception as e:
            # 醒目紅色警示
            print(f"\033[91m⚠️ [讀取失敗] 標的 {symbol} {name} ({market}) 無法獲取價格或歷史資料: {e}\033[0m")
            price_failed_stocks.append({
                'Code': symbol,
                'Name': name
            })

    # ============================================
    # 計算市場健康度（加權指數/OTC 是否站上 60MA）
    # ============================================
    market_health = calc_market_health()

    # ============================================
    # 輸出 data.js（供前端直接引入）
    # ============================================
    now_str = pd.Timestamp.now().strftime('%Y-%m-%d %H:%M:%S')
    
    # 讀取 rules.json
    rules = {}
    try:
        with open('rules.json', 'r', encoding='utf-8') as rf:
            rules = json.load(rf)
    except Exception as e:
        print(f"無法讀取 rules.json: {e}")
        rules = {"scoring": {"rev_growth":20, "eps_growth":15, "roe":10, "trust_days":3, "daily_vol":2000, "market_cap":50, "vol_ratio":1.5, "dist_52w":15}}

    rules_json_str = json.dumps(rules, ensure_ascii=False, indent=2)

    # 包含失敗股票清單在 marketData 中
    market_data_dict = {
        "twii_above_60ma": bool(market_health['twii']),
        "otc_above_60ma": bool(market_health['otc']),
        "vol_above_20ma": bool(market_health['vol']),
        "lastUpdate": now_str,
        "price_failed_stocks": price_failed_stocks
    }

    js_content = f"""// 由 yfinance 產生之真實資料 — {now_str}
const marketData = {json.dumps(market_data_dict, ensure_ascii=False, indent=2)};

const rulesConfig = {rules_json_str};

const mockStocks = {json.dumps(results, ensure_ascii=False, indent=2)};

// 評分邏輯 (滿分 12 分，null 值欄位不計分不扣分)
function calculateScore(stock) {{
  let score = 0;
  let totalChecks = 0;
  function check(val, cond) {{ if (val != null) {{ totalChecks++; if (cond) score++; }} }}
  
  const sc = rulesConfig.scoring;
  // 基本面（可能為 null）
  check(stock.revYoY,     stock.revYoY > sc.rev_growth);
  check(stock.epsYoY,     stock.epsYoY > sc.eps_growth);
  check(stock.roe,        stock.roe > sc.roe);
  // 籌碼（可能為 null）
  check(stock.trustDays,  stock.trustDays >= sc.trust_days);
  check(stock.foreignBuy, stock.foreignBuy === true);
  // 技術面（真實計算，部份欄位如週轉率、市值為 null）
  if (stock.dailyVol   > sc.daily_vol) score++;
  check(stock.marketCap, stock.marketCap > sc.market_cap);
  if (stock.maBull)            score++;
  if (stock.ma20Rising)        score++;
  if (stock.volRatio   > sc.vol_ratio)  score++;
  if (stock.closeToHigh)       score++;
  if (stock.dist52W    < sc.dist_52w)   score++;
  return score;
}}

mockStocks.forEach(s => s.score = calculateScore(s));
"""

    with open('data.js', 'w', encoding='utf-8') as f:
        f.write(js_content)

    print(f"\n==========================================")
    print(f"🎉 執行完畢！")
    print(f"👉 成功產出 {len(results)} 檔。")
    if price_failed_stocks:
        print(f"\033[93m⚠️  警告：共有 {len(price_failed_stocks)} 檔股票無法讀取價格！\033[0m")
        print(f"已覆寫 data.js 並記錄失敗標的。")
    print(f"==========================================\n")


if __name__ == "__main__":
    run_screener()
