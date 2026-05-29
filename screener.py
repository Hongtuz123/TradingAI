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
    - 1000 以上保留原樣 (例如 2330 -> 2330)
    注意：類似 009816 的 ETF 代碼，Excel 可能將其變為 9816 (4碼純數字)。
    這類情況由 run_screener() 中的 zfill(6) fallback 處理，
    前端則由 stock-dashboard.js 中的 padStart(6) fallback 補救。
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

def safe_float(val):
    if val is None or val == "":
        return None
    try:
        return float(str(val).replace(",", "").strip())
    except ValueError:
        return None

def get_stock_code(row):
    code = row.get("公司代號") or row.get("SecuritiesCompanyCode") or row.get("Code")
    if code:
        return str(code).strip()
    return None

def fetch_openapi_fundamentals():
    print("⏳ 開始下載台灣官方 OpenAPI 批量基本面數據...")
    fundamentals = {}

    # 1. 抓取上市櫃月營收 YoY
    try:
        res = requests.get("https://openapi.twse.com.tw/v1/opendata/t187ap05_L", timeout=10)
        if res.status_code == 200:
            for r in res.json():
                code = get_stock_code(r)
                if code:
                    val = safe_float(r.get("營業收入-去年同月增減(%)"))
                    if val is not None:
                        fundamentals.setdefault(code, {})["revYoY"] = round(val, 2)
    except Exception as e:
        print(f"  ⚠️ 上市月營收抓取失敗: {e}")

    try:
        res = requests.get("https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O", timeout=10)
        if res.status_code == 200:
            for r in res.json():
                code = get_stock_code(r)
                if code:
                    val = safe_float(r.get("營業收入-去年同月增減(%)"))
                    if val is not None:
                        fundamentals.setdefault(code, {})["revYoY"] = round(val, 2)
    except Exception as e:
        print(f"  ⚠️ 上櫃月營收抓取失敗: {e}")

    # 2. 抓取上市櫃毛利率
    try:
        res = requests.get("https://openapi.twse.com.tw/v1/opendata/t187ap17_L", timeout=10)
        if res.status_code == 200:
            for r in res.json():
                code = get_stock_code(r)
                if code:
                    val = safe_float(r.get("毛利率(%)(營業毛利)/(營業收入)"))
                    if val is not None:
                        fundamentals.setdefault(code, {})["grossMargin"] = round(val, 2)
    except Exception as e:
        print(f"  ⚠️ 上市毛利率抓取失敗: {e}")

    try:
        res = requests.get("https://www.tpex.org.tw/openapi/v1/mopsfin_187ap17_O", timeout=10)
        if res.status_code == 200:
            for r in res.json():
                code = get_stock_code(r)
                if code:
                    val = safe_float(r.get("毛利率"))
                    if val is not None:
                        fundamentals.setdefault(code, {})["grossMargin"] = round(val, 2)
    except Exception as e:
        print(f"  ⚠️ 上櫃毛利率抓取失敗: {e}")

    # 3. 抓取上市櫃資產負債表並計算負債比與留存權益總額與股本
    equity_data = {}
    capital_data = {}
    try:
        res = requests.get("https://openapi.twse.com.tw/v1/opendata/t187ap07_L_ci", timeout=10)
        if res.status_code == 200:
            for r in res.json():
                code = get_stock_code(r)
                if code:
                    debt = safe_float(r.get("負債總額"))
                    assets = safe_float(r.get("資產總額"))
                    equity = safe_float(r.get("權益總額"))
                    capital = safe_float(r.get("股本"))
                    if debt is not None and assets is not None and assets > 0:
                        fundamentals.setdefault(code, {})["debtRatio"] = round((debt / assets) * 100, 2)
                    if equity is not None:
                        equity_data[code] = equity
                    if capital is not None:
                        capital_data[code] = capital
    except Exception as e:
        print(f"  ⚠️ 上市資產負債表抓取失敗: {e}")

    try:
        res = requests.get("https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap07_O_ci", timeout=10)
        if res.status_code == 200:
            for r in res.json():
                code = get_stock_code(r)
                if code:
                    debt = safe_float(r.get("負債總額"))
                    assets = safe_float(r.get("資產總額"))
                    equity = safe_float(r.get("權益總額"))
                    capital = safe_float(r.get("股本"))
                    if debt is not None and assets is not None and assets > 0:
                        fundamentals.setdefault(code, {})["debtRatio"] = round((debt / assets) * 100, 2)
                    if equity is not None:
                        equity_data[code] = equity
                    if capital is not None:
                        capital_data[code] = capital
    except Exception as e:
        print(f"  ⚠️ 上櫃資產負債表抓取失敗: {e}")

    # 4. 抓取上市櫃當季 EPS 與稅後淨利
    print("  正在抓取當季 EPS 與稅後淨利...")
    eps_data = {}
    try:
        res = requests.get("https://openapi.twse.com.tw/v1/opendata/t187ap14_L", timeout=10)
        if res.status_code == 200:
            for r in res.json():
                code = get_stock_code(r)
                if code:
                    eps_val = safe_float(r.get("基本每股盈餘(元)"))
                    net_inc = safe_float(r.get("稅後淨利"))
                    eps_data[code] = {"eps": eps_val, "netIncome": net_inc}
    except Exception as e:
        print(f"  ⚠️ 上市 EPS 抓取失敗: {e}")

    try:
        res = requests.get("https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O", timeout=10)
        if res.status_code == 200:
            for r in res.json():
                code = get_stock_code(r)
                if code:
                    eps_val = safe_float(r.get("基本每股盈餘"))
                    net_inc = safe_float(r.get("稅後淨利"))
                    eps_data[code] = {"eps": eps_val, "netIncome": net_inc}
    except Exception as e:
        print(f"  ⚠️ 上櫃 EPS 抓取失敗: {e}")

    # 5. 合併計算 ROE 與 EPS
    print("  正在進行 ROE 計算與最後基本面數據彙整...")
    all_codes = set(list(fundamentals.keys()) + list(eps_data.keys()))
    for code in all_codes:
        fundamentals.setdefault(code, {})
        
        eps_info = eps_data.get(code, {})
        fundamentals[code]["eps"] = eps_info.get("eps")
        
        # 股本放入以供後面計算週轉率與市值
        fundamentals[code]["capital"] = capital_data.get(code)
        
        net_inc = eps_info.get("netIncome")
        equity = equity_data.get(code)
        if net_inc is not None and equity is not None and equity > 0:
            fundamentals[code]["roe"] = round((net_inc / equity) * 100, 2)
        else:
            fundamentals[code]["roe"] = None

    print(f"🎉 OpenAPI 基本面數據下載完成！共彙整 {len(fundamentals)} 檔股票。")
    return fundamentals


def calc_market_health():
    """
    計算市場健康度：
    - 台股（TWII、TWOII）：漲跌幅、是否>20MA、是否>60MA
    - 美股五大指數（SOX、NDX、RUT、DJI、SPX）：漲跌幅
    """
    def _safe_pct(hist):
        """計算前一日漲跌幅（%），最少需要 2 筆資料"""
        if len(hist) >= 2:
            prev = float(hist['Close'].iloc[-2])
            curr = float(hist['Close'].iloc[-1])
            if prev and prev != 0:
                return round((curr - prev) / prev * 100, 2)
        return None

    def _calc_vol_level(volume, hist_df):
        """依據今日 Volume 相比 20MA 均量，劃分 少/普通/多 三個等級 (過濾 0 值)"""
        if not volume or hist_df.empty or len(hist_df) < 20:
            return '普通'
        
        # 計算不含今日/最後一天的 20 日均量
        valid_vols = hist_df['Volume'][hist_df['Volume'] > 0]
        if len(valid_vols) < 20:
            return '普通'
        avg_vol = valid_vols.rolling(20).mean().iloc[-1]
        
        if not avg_vol or avg_vol == 0:
            return '普通'
        ratio = volume / avg_vol
        if ratio < 0.85:
            return '少'
        elif ratio > 1.15:
            return '多'
        else:
            return '普通'

    def _tw_index(symbol, label):
        """回傳台股指數所需欄位（加入成交量防禦 0 值過濾）"""
        item = {
            'label': label,
            'pct_chg': None,
            'close': None,
            'above_20ma': None,
            'above_60ma': None,
            'volume': None,
            'vol_level': '普通'
        }
        try:
            hist = yf.Ticker(symbol).history(period='130d', interval='1d')
            if hist.empty:
                return item
            item['close'] = round(float(hist['Close'].iloc[-1]), 2)
            item['pct_chg'] = _safe_pct(hist)
            
            # 成交量防禦 0 值過濾：若最後一天的 Volume 為 0 (例如 yfinance 還沒更新好該欄位)，使用最近一筆 > 0 的成交量
            vols_series = hist['Volume']
            valid_vols = vols_series[vols_series > 0]
            latest_vol = int(valid_vols.iloc[-1]) if not valid_vols.empty else 0
            
            item['volume'] = latest_vol
            item['vol_level'] = _calc_vol_level(latest_vol, hist)

            if len(hist) >= 20:
                ma20 = float(hist['Close'].rolling(20).mean().iloc[-1])
                item['above_20ma'] = item['close'] > ma20
            if len(hist) >= 60:
                ma60 = float(hist['Close'].rolling(60).mean().iloc[-1])
                item['above_60ma'] = item['close'] > ma60
        except Exception as e:
            print(f'  台股指數 {symbol} 計算失敗: {e}')
        return item

    def _us_index(symbol, label):
        """回傳美股指數所需欄位（加入成交量防禦 0 值過濾）"""
        item = {
            'label': label,
            'pct_chg': None,
            'close': None,
            'volume': None,
            'vol_level': '普通'
        }
        try:
            hist = yf.Ticker(symbol).history(period='35d', interval='1d')
            if hist.empty:
                return item
            item['close'] = round(float(hist['Close'].iloc[-1]), 2)
            item['pct_chg'] = _safe_pct(hist)
            
            # 成交量防禦 0 值過濾
            vols_series = hist['Volume']
            valid_vols = vols_series[vols_series > 0]
            latest_vol = int(valid_vols.iloc[-1]) if not valid_vols.empty else 0
            
            item['volume'] = latest_vol
            item['vol_level'] = _calc_vol_level(latest_vol, hist)
        except Exception as e:
            print(f'  美股指數 {symbol} 計算失敗: {e}')
        return item

    # --- 台股 ---
    twii_data  = _tw_index('^TWII',  '加權指數')
    twoii_data = _tw_index('^TWOII', '櫃買指數')

    # 🚀 TWSE/TPEx 官方 API 大盤補償防禦機制，解決 yfinance 指數數據滯後問題
    import requests as _req
    
    # 1. 補償加權指數 (^TWII)
    try:
        print("🔍 正在透過 TWSE 官方 API 驗證加權指數精準度...")
        res = _req.get("https://www.twse.com.tw/exchangeReport/FMTQIK?response=json", timeout=8)
        if res.status_code == 200:
            f_data = res.json()
            if 'data' in f_data and len(f_data['data']) > 0:
                last_row = f_data['data'][-1]
                # last_row: ['115/05/28', '19,686,100,251', '1,670,718,874,089', '9,346,566', '43,636.44', '-620.36']
                raw_close = float(last_row[4].replace(',', ''))
                raw_diff = float(last_row[5].replace(',', ''))
                prev_close = raw_close - raw_diff
                pct_chg = round((raw_diff / prev_close) * 100, 2)
                
                print(f"  TWSE 官方最新加權指數: {raw_close} (漲跌: {raw_diff}, 幅度: {pct_chg}%)")
                
                # 如果 yfinance 滯後（yfinance 的 close 與官方不同），使用官方最新精準數據覆蓋
                if twii_data['close'] != raw_close:
                    print(f"  ⚠️ 偵測到 yfinance 加權數據滯後 (yf: {twii_data['close']} vs 官方: {raw_close})，已自動採用官方最新盤後數據進行精準覆蓋！")
                    twii_data['close'] = raw_close
                    twii_data['pct_chg'] = pct_chg
    except Exception as e_twii:
        print(f"  ⚠️ TWSE 官方加權指數補償失敗 (將維持 yfinance 預設值): {e_twii}")

    # 2. 補償櫃買指數 (^TWOII)
    try:
        print("🔍 正在透過 TPEx 官方 API 驗證櫃買指數精準度...")
        res = _req.get("https://www.tpex.org.tw/web/stock/aftertrading/index_summary/summary_result.php?l=zh-tw&o=json", timeout=8)
        if res.status_code == 200:
            otc_data = res.json()
            if 'tables' in otc_data and len(otc_data['tables']) > 0:
                t0 = otc_data['tables'][0]
                if 'data' in t0 and len(t0['data']) > 0:
                    for row in t0['data']:
                        if row[0] == '櫃買指數':
                            # row: ['櫃買指數', '432.48', '-7.71', '-1.75', ...]
                            raw_close = float(row[1].replace(',', ''))
                            pct_chg = float(row[3].replace(',', ''))
                            print(f"  TPEx 官方最新櫃買指數: {raw_close} (幅度: {pct_chg}%)")
                            
                            if twoii_data['close'] != raw_close:
                                print(f"  ⚠️ 偵測到 yfinance 櫃買數據滯後 (yf: {twoii_data['close']} vs 官方: {raw_close})，已自動採用官方最新數據進行覆蓋！")
                                twoii_data['close'] = raw_close
                                twoii_data['pct_chg'] = pct_chg
                            break
    except Exception as e_otc:
        print(f"  ⚠️ TPEx 官方櫃買指數補償失敗 (將維持 yfinance 預設值): {e_otc}")


    # 大盤量 > 20MA（用加權指數量，過濾 0 值）
    vol_above_20ma = None
    vol_level = '普通'
    latest_vol_num = None
    try:
        hist_vol = yf.Ticker('^TWII').history(period='60d', interval='1d')
        if len(hist_vol) >= 20:
            valid_vols = hist_vol['Volume'][hist_vol['Volume'] > 0]
            vol_ma20 = float(valid_vols.rolling(20).mean().iloc[-1]) if len(valid_vols) >= 20 else 0
            
            # 最新有效量
            latest_vol_num = float(valid_vols.iloc[-1]) if not valid_vols.empty else 0
            
            if vol_ma20 > 0:
                vol_above_20ma = latest_vol_num > vol_ma20
                ratio = latest_vol_num / vol_ma20
                if ratio < 0.85:
                    vol_level = '少'
                elif ratio > 1.15:
                    vol_level = '多'
                else:
                    vol_level = '普通'
    except Exception as e:
        print(f'  大盤量計算失敗: {e}')

    # --- 美股 ---
    us_indices = [
        _us_index('^SOX',  '費半 SOX'),
        _us_index('^NDX',  '那斯達克 100'),
        _us_index('^RUT',  '羅素 2000'),
        _us_index('^DJI',  '道瓊 DJI'),
        _us_index('^GSPC', 'S&P 500'),
        _us_index('^VIX',  'VIX 恐慌指數'),
    ]

    return {
        'tw': [twii_data, twoii_data],
        'vol_above_20ma': vol_above_20ma,
        'vol_level': vol_level,
        'latest_vol_num': latest_vol_num,
        'us': us_indices,
        # 向下相容舊欄位
        'twii': twii_data.get('above_60ma', True),
        'otc':  twoii_data.get('above_60ma', True),
        'vol':  bool(vol_above_20ma) if vol_above_20ma is not None else True,
    }


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
    技術型態分類（可多選）
    A = 突破型：收盤站上近20日新高 + 量能放大
    B = 均線多頭：5MA > 20MA > 60MA 且股價 > 5MA
    C = 剛轉強：MACD 柱由負轉正 且 RSI 從 ≤50 突破 50
    D = 強勢回檔：股價 > 20MA 但量能偏低（回檔整理）
    E = 趨勢多頭：股價 >= 20MA 且 20MA 走升
    回傳以逗號分隔的字串，若皆不符合則回傳 'none'
    """
    types = []
    recent_high = latest.get('recent_high', close) if hasattr(latest, 'get') else latest['recent_high'] if 'recent_high' in latest else close

    # A 型突破型
    if close >= recent_high and vol > latest['vol_ma20'] * 1.5:
        types.append('A')
    # C 型剛轉強
    if prev['hist'] <= 0 and latest['hist'] > 0 and prev['rsi14'] <= 50 and latest['rsi14'] > 50:
        types.append('C')
    # B 型均線多頭
    if latest['ma5'] > latest['ma20'] > latest['ma60'] and close > latest['ma5']:
        types.append('B')
    # D 型強勢回檔
    if close > latest['ma20'] and vol < latest['vol_ma20']:
        types.append('D')
    # E 型趨勢多頭
    if close >= latest['ma20'] and latest.get('ma20_rising', False):
        types.append('E')

    return ",".join(types) if types else 'none'


def fetch_institutional_data():
    """
    從 TWSE 和 TPEx 抓取最新有資料交易日的三大法人數據
    回傳一個 dict: { '股票代碼': { 'trust': 投信買賣超張數, 'foreign': 外資買賣超張數 } }
    """
    import datetime
    import time
    
    # 產生最近 10 天的日期候選名單，用來自動回溯
    now = datetime.datetime.now()
    twse_dates = []
    tpex_dates = []
    for i in range(10):
        d = now - datetime.timedelta(days=i)
        # 上市：YYYYMMDD
        twse_dates.append(d.strftime("%Y%m%d"))
        # 上櫃：民國年/MM/DD
        roc_year = d.year - 1911
        tpex_dates.append(f"{roc_year}/{d.strftime('%m/%d')}")
        
    inst_data = {}
    valid_idx = -1
    
    print("  正在探測最新的上市三大法人交易日資料...")
    # 1. 探測 TWSE 資料
    for idx, date_str in enumerate(twse_dates):
        url = f"https://www.twse.com.tw/rwd/zh/fund/T86?date={date_str}&selectType=ALLBUT0999&response=json"
        try:
            res = requests.get(url, timeout=10)
            if res.status_code == 200:
                data = res.json()
                if data.get("stat") == "OK" and "data" in data:
                    print(f"  ✅ 成功取得 {date_str} 上市三大法人資料！共 {len(data['data'])} 筆。")
                    valid_idx = idx
                    
                    # 解析 fields 尋找外資、投信與自營商索引
                    fields = data.get("fields", [])
                    foreign_idx = -1
                    trust_idx = -1
                    dealer_idx = -1
                    for f_idx, field in enumerate(fields):
                        if "外陸資" in field and "買賣超" in field and "不含外資自營商" in field:
                            foreign_idx = f_idx
                        elif "投信" in field and "買賣超" in field:
                            trust_idx = f_idx
                        elif "自營商" in field and "買賣超" in field and "自行買賣" not in field and "避險" not in field:
                            dealer_idx = f_idx
                            
                    # fallback 至預設索引
                    if foreign_idx == -1: foreign_idx = 4
                    if trust_idx == -1: trust_idx = 10
                    if dealer_idx == -1: dealer_idx = 11
                    
                    for row in data["data"]:
                        code = row[0].strip()
                        # 去除逗號並轉為股數，再除以 1000 得到張數
                        try:
                            foreign_val = int(row[foreign_idx].replace(",", "")) // 1000
                        except Exception:
                            foreign_val = 0
                        try:
                            trust_val = int(row[trust_idx].replace(",", "")) // 1000
                        except Exception:
                            trust_val = 0
                        try:
                            dealer_val = int(row[dealer_idx].replace(",", "")) // 1000
                        except Exception:
                            dealer_val = 0
                        
                        inst_data[code] = {
                            "foreign": foreign_val,
                            "trust": trust_val,
                            "dealer": dealer_val
                        }
                    break
                else:
                    # 資料尚未公布或假日無交易
                    pass
        except Exception as e:
            print(f"  探測上市日期 {date_str} 出錯: {e}")
        time.sleep(0.1) # 遵守 100ms 間隔限制
        
    if valid_idx == -1:
        print("  ⚠️ 無法抓取到 any 最近的上市三大法人資料！")
        return {}
        
    # 2. 既然抓到了有效交易日，用對應的日期去抓 TPEx (上櫃)
    tpex_date_str = tpex_dates[valid_idx]
    print(f"  正在同步抓取上櫃三大法人資料，日期: {tpex_date_str}...")
    tpex_url = f"https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&t=D&d={tpex_date_str}&s=0,asc"
    try:
        res = requests.get(tpex_url, timeout=10)
        if res.status_code == 200:
            data = res.json()
            if "tables" in data and len(data["tables"]) > 0:
                table = data["tables"][0]
                if "data" in table:
                    print(f"  ✅ 成功取得 {tpex_date_str} 上櫃三大法人資料！共 {len(table['data'])} 筆。")
                    for row in table["data"]:
                        if len(row) >= 23:
                            code = row[0].strip()
                            try:
                                foreign_val = int(row[4].replace(",", "")) // 1000
                            except Exception:
                                foreign_val = 0
                            try:
                                trust_val = int(row[13].replace(",", "")) // 1000
                            except Exception:
                                trust_val = 0
                            try:
                                dealer_val = int(row[22].replace(",", "")) // 1000
                            except Exception:
                                dealer_val = 0
                            
                            # 合併或寫入
                            inst_data[code] = {
                                "foreign": foreign_val,
                                "trust": trust_val,
                                "dealer": dealer_val
                            }
    except Exception as e:
        print(f"  抓取上櫃三大法人出錯: {e}")
        
    return inst_data


def run_screener():
    print("讀取股票評估清單 CSV...")
    base_dir = os.path.dirname(os.path.abspath(__file__))
    csv_path = os.path.join(base_dir, "股票分析清單.csv")
    csv_stocks = read_stock_list_from_csv(csv_path)
    
    if not csv_stocks:
        print("⚠️ CSV 清單為空或讀取失敗，改用預設 WATCHLIST...")
        csv_stocks = WATCHLIST
        
    print("下載三大法人當日買賣超資料...")
    inst_data = fetch_institutional_data()
    
    # 批量抓取官方 OpenAPI 基本面數據 (營收YoY、毛利率、負債比)
    openapi_fund = fetch_openapi_fundamentals()
        
    print(f"載入 TWSE/TPEX OpenAPI 市場資訊...")
    all_market_info = load_all_market_info()
    
    # 建立 yfinance 代碼與股票資料對照表
    yf_to_stock = {}
    tickers = []
    for s in csv_stocks:
        code = s['Code']
        
        # 智慧前導零補正邏輯：
        # 如果原始代碼不在 all_market_info 裡面，但補零為 6 碼後在裡面，就自動修正（解決 Excel/CSV 將 009816 轉成 9816 的前導零丟失問題）
        if code not in all_market_info and len(code) < 6:
            candidate = code.zfill(6)
            if candidate in all_market_info:
                print(f"  💡 偵測到 CSV 股票代碼 {code} 前導零丟失，已智慧修正為 {candidate} ({all_market_info[candidate].get('Name')})")
                code = candidate
                s['Code'] = candidate

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

            # 漲跌幅：改用昨收價計算（台股標準）
            try:
                prev_close = float(prev['close'])
                if prev_close > 0:
                    change_num = round(((close - prev_close) / prev_close) * 100, 2)
                else:
                    change_num = 0.0
            except Exception:
                change_num = 0.0

            # 真實技術指標值
            rsi_val  = round(float(latest['rsi14']), 2)
            macd_val = round(float(latest['macd']), 4)
            atr_val  = round(float(latest['atr14']), 2)
            bb_upper = round(float(latest['bb_upper']), 2)
            bb_lower = round(float(latest['bb_lower']), 2)
            ma5_val  = round(float(latest['ma5']), 2)
            ma20_val = round(float(latest['ma20']), 2)
            ma60_val = round(float(latest['ma60']), 2)

            # 三大法人買賣超數據
            inst_info = inst_data.get(symbol, {"trust": 0, "foreign": 0, "dealer": 0})
            trust_net_buy = inst_info.get("trust", 0)
            foreign_net_buy = inst_info.get("foreign", 0)
            dealer_net_buy = inst_info.get("dealer", 0)
            foreign_buy_bool = bool(foreign_net_buy > 0)

            # 官方 OpenAPI 基本面數據
            fund_info = openapi_fund.get(symbol, {})
            rev_yoy = fund_info.get("revYoY")
            gross_margin = fund_info.get("grossMargin")
            debt_ratio = fund_info.get("debtRatio")
            eps_val = fund_info.get("eps")
            roe_val = fund_info.get("roe")
            capital_val = fund_info.get("capital")

            # 智慧批量計算週轉率與市值 (100% 覆蓋)
            turnover_val = None
            market_cap_val = None
            if capital_val and capital_val > 0:
                # 週轉率 (%) = 當日成交量(股) / (股本(千元) * 100) * 100 = vol / (capital_val * 100) * 100 = vol / capital_val
                turnover_val = round(vol / capital_val, 2)
                # 市值 (億) = 收盤價 * (股本(千元) * 100) / 100,000,000 = close * 股本 / 1,000,000
                market_cap_val = round((close * capital_val) / 1000000, 2)

            results.append({
                "id": symbol, "name": name, "market": market,
                "price": round(close, 2), "change": round(change_num, 2),
                "epsYoY": None,  # 將在最後精選 Top 40 中局部下載
                "eps": eps_val,  # 批量單季 EPS
                "revYoY": rev_yoy,
                "roe": roe_val,   # 批量年化 ROE
                "grossMargin": gross_margin,
                "debtRatio": debt_ratio,
                "trustDays": trust_net_buy, 
                "foreignBuy": foreign_buy_bool,
                "foreignNetBuy": foreign_net_buy,
                "dealerDays": dealer_net_buy,
                "volRatio": vol_ratio, "turnover": turnover_val,
                "marketCap": market_cap_val, "dailyVol": vol // 1000,
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
                "kline": sorted(candles, key=lambda x: x['date'])[-250:]
            })
            
        except Exception as e:
            # 醒目紅色警示
            print(f"\033[91m⚠️ [讀取失敗] 標的 {symbol} {name} ({market}) 無法獲取價格或歷史資料: {e}\033[0m")
            price_failed_stocks.append({
                'Code': symbol,
                'Name': name
            })

    # ============================================
    # 計算初步得分，對 results 排序，並局部透過 yfinance 補齊 Top 40 基本面
    # ============================================
    def calc_preliminary_score(stock):
        score = 0
        if stock.get("maBull"): score += 2
        if stock.get("ma20Rising"): score += 1
        if (stock.get("trustDays") or 0) > 0: score += 2
        if stock.get("foreignNetBuy") and stock.get("foreignNetBuy") > 0: score += 1
        if stock.get("revYoY") and stock.get("revYoY") > 15: score += 2
        if stock.get("grossMargin") and stock.get("grossMargin") > 15: score += 2
        if (stock.get("volRatio") or 0) > 1.2: score += 1
        return score

    results.sort(key=calc_preliminary_score, reverse=True)
    top_40 = results[:40]
    
    print(f"\n⚡️ 針對初步排序前 {len(top_40)} 檔精選標的，局部下載 yfinance 高精度基本面資料...")
    for idx, s in enumerate(top_40):
        symbol = s["id"]
        market = s["market"]
        suffix = '.TWO' if market == 'OTC' else '.TW'
        yf_ticker = f"{symbol}{suffix}"
        try:
            ticker_obj = yf.Ticker(yf_ticker)
            info = ticker_obj.info
            if info.get('earningsQuarterlyGrowth') is not None:
                s['epsYoY'] = round(info.get('earningsQuarterlyGrowth', 0) * 100, 2)
            if info.get('returnOnEquity') is not None:
                s['roe'] = round(info.get('returnOnEquity', 0) * 100, 2)
            if info.get('marketCap') is not None:
                s['marketCap'] = round(info.get('marketCap', 0) / 100000000, 2)  # 轉為億元
            print(f"  [{idx+1}/40] ✅ 成功補齊 {symbol} {s['name']}: EPS YoY {s.get('epsYoY')}%, ROE {s.get('roe')}%, 市值 {s.get('marketCap')} 億")
        except Exception as fe:
            print(f"  [{idx+1}/40] ⚠️ 無法補齊 {symbol} 的 yfinance 資料: {fe}")

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
        rules = {"scoring": {"rev_growth":20, "eps_growth":15, "roe":10, "trust_days":10, "daily_vol":2000, "market_cap":50, "vol_ratio":1.5, "dist_52w":15}}

    rules_json_str = json.dumps(rules, ensure_ascii=False, indent=2)

    # 包含失敗股票清單在 marketData 中
    market_data_dict = {
        # 新結構：台股指數（含漲跌幅、20MA、60MA、量與量能級別）
        "tw_indices": market_health['tw'],
        # 新結構：美股指數（含漲跌幅、量與量能級別）
        "us_indices": market_health['us'],
        # 大盤量指標
        "vol_above_20ma": market_health['vol_above_20ma'],
        "vol_level": market_health['vol_level'],
        "latest_vol_num": market_health['latest_vol_num'],
        # 向下相容舊欄位（避免 JS 舊引用爆炸）
        "twii_above_60ma": bool(market_health['twii']),
        "otc_above_60ma":  bool(market_health['otc']),
        "vol_above_20ma_bool": bool(market_health['vol']),
        "lastUpdate": now_str,
        "price_failed_stocks": price_failed_stocks
    }

    js_content = f"""// 由 yfinance 產生之真實資料 — {now_str}
const marketData = {json.dumps(market_data_dict, ensure_ascii=False, indent=2)};

const rulesConfig = {rules_json_str};

const mockStocks = {json.dumps(results, ensure_ascii=False, indent=2)};
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

    # 自動 git commit + push，讓 Vercel 同步更新雲端網站
    try:
        import subprocess as _sp
        _sp.run(['git', 'add', 'data.js'], check=True)
        _sp.run(['git', 'commit', '-m', f'data: 自動更新選股數據 {now_str}'], check=True)
        
        # 🚀 防禦機制：推送前先做 pull --rebase，並在衝突時優先使用我們本地新產出的 data.js，避免 rejected
        print("🔄 正在拉取遠端最新狀態以防止 Git 衝突...")
        _sp.run(['git', 'pull', '--rebase', '-X', 'ours', 'origin', 'main'], check=True)
        
        _sp.run(['git', 'push', 'origin', 'main'], check=True)
        print("✅ data.js 已自動推送至 GitHub，Vercel 雲端網站將在約 30 秒內同步更新！")
    except Exception as git_err:
        print(f"⚠️  自動 git push 失敗（不影響本機使用）：{git_err}")


if __name__ == "__main__":
    run_screener()
