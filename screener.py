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
    {'Code': '1342', 'Name': '八貫',   'market': 'TSE'},
    {'Code': '2472', 'Name': '立隆電', 'market': 'TSE'},
    {'Code': '3008', 'Name': '大立光', 'market': 'TSE'},
    {'Code': '3034', 'Name': '聯詠',   'market': 'TSE'},
    {'Code': '3406', 'Name': '玉晶光', 'market': 'TSE'},
    {'Code': '4958', 'Name': '臻鼎-KY', 'market': 'TSE'},
    {'Code': '4961', 'Name': '天鈺',   'market': 'TSE'},
    {'Code': '5228', 'Name': '鈺鎧',   'market': 'OTC'},
    {'Code': '6525', 'Name': '捷敏-KY', 'market': 'TSE'},
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


def get_sector_streak_days_py(sector_name, streak_type, sec_history):
    if not sec_history or not isinstance(sec_history, list):
        return 1
    streak = 0
    for hist in sec_history:
        s_list = hist.get(streak_type, [])
        if sector_name in s_list:
            streak += 1
        else:
            break
    return streak if streak > 0 else 1

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
    - 台股（TWII、TWOII、WTXP&）：漲跌幅、成交量相較20MA均量
    - 美股五大指數（SOX、NDX、RUT、DJI、SPX）：漲跌幅、成交量相較20MA均量
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
        """回傳台股指數所需欄位（加入成交量比率與 MA）"""
        item = {
            'label': label,
            'pct_chg': None,
            'close': None,
            'above_20ma': None,
            'above_60ma': None,
            'volume': None,
            'vol_level': '普通',
            'vol_ratio': 1.0
        }
        try:
            hist = yf.Ticker(symbol).history(period='130d', interval='1d')
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

            # 計算 20MA 均量比率
            avg_vol = valid_vols.rolling(20).mean().iloc[-1] if len(valid_vols) >= 20 else 0
            item['vol_ratio'] = round(latest_vol / avg_vol, 3) if avg_vol > 0 else 1.0

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
        """回傳美股指數所需欄位（加入成交量比率）"""
        item = {
            'label': label,
            'pct_chg': None,
            'close': None,
            'volume': None,
            'vol_level': '普通',
            'vol_ratio': 1.0
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

            # 計算 20MA 均量比率
            avg_vol = valid_vols.rolling(20).mean().iloc[-1] if len(valid_vols) >= 20 else 0
            item['vol_ratio'] = round(latest_vol / avg_vol, 3) if avg_vol > 0 else 1.0
        except Exception as e:
            print(f'  美股指數 {symbol} 計算失敗: {e}')
        return item

    # 1. 抓取台指期盤後 (夜盤) 資料，並維護本地歷史累積量
    def _wtx_night_index():
        item = {
            'label': '台指夜盤',
            'pct_chg': None,
            'close': None,
            'above_20ma': True,
            'above_60ma': True,
            'volume': None,
            'vol_level': '普通',
            'vol_ratio': 1.0
        }
        url = "https://openapi.taifex.com.tw/v1/DailyMarketReportFut"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        try:
            res = _req.get(url, headers=headers, timeout=10)
            if res.status_code != 200:
                print(f"  期交所 API 請求失敗: {res.status_code}")
                return item
            
            data = res.json()
            tx_night = [d for d in data if d.get("Contract") == "TX" and d.get("TradingSession") == "盤後"]
            if not tx_night:
                print("  期交所 API 未找到 TX 盤後合約")
                return item
            
            # 排序取近月合約
            tx_night.sort(key=lambda x: x.get("ContractMonth(Week)", "999999"))
            target = tx_night[0]
            
            date_str = target.get("Date")  # 格式 YYYYMMDD
            formatted_date = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}" if len(date_str) == 8 else date_str
            
            close_val = float(target.get("Last", "0").replace(",", ""))
            pct_str = target.get("%", "0%").replace("%", "").replace(",", "")
            pct_chg = float(pct_str)
            vol_val = int(target.get("Volume", "0").replace(",", ""))
            
            item['close'] = close_val
            item['pct_chg'] = pct_chg
            item['volume'] = vol_val
            
            # 維護本地歷史 JSON
            history_path = "scratch/wtx_history.json"
            history = []
            if os.path.exists(history_path):
                try:
                    with open(history_path, "r", encoding="utf-8") as rf:
                        history = json.load(rf)
                except Exception as je:
                    print(f"  讀取 wtx_history.json 失敗: {je}")
            
            # 檢查並更新或寫入當日
            existing = [h for h in history if h.get("date") == formatted_date]
            if not existing:
                history.append({
                    "date": formatted_date,
                    "close": close_val,
                    "volume": vol_val,
                    "pct_chg": pct_chg
                })
                history.sort(key=lambda x: x.get("date", ""))
                history = history[-60:]
            else:
                for h in history:
                    if h["date"] == formatted_date:
                        h["close"] = close_val
                        h["volume"] = vol_val
                        h["pct_chg"] = pct_chg
            
            try:
                os.makedirs(os.path.dirname(history_path), exist_ok=True)
                with open(history_path, "w", encoding="utf-8") as wf:
                    json.dump(history, wf, ensure_ascii=False, indent=2)
            except Exception as we:
                print(f"  寫入 wtx_history.json 失敗: {we}")
            
            # 計算 20MA 均量與 Close 均線
            valid_hist = [h for h in history if h.get("volume", 0) > 0]
            if len(valid_hist) >= 20:
                last_20_vol = valid_hist[-20:]
                vol_ma20 = sum(h["volume"] for h in last_20_vol) / 20.0
            else:
                vol_ma20 = 50000.0  # 預設 20MA 均量基準值
            
            item['vol_ratio'] = round(vol_val / vol_ma20, 3) if vol_ma20 > 0 else 1.0
            
            # 決定量能級別 vol_level
            if item['vol_ratio'] < 0.85:
                item['vol_level'] = '少'
            elif item['vol_ratio'] > 1.15:
                item['vol_level'] = '多'
            else:
                item['vol_level'] = '普通'
            
            # 均線判定
            if history:
                avg_close_20 = sum(h["close"] for h in history[-20:]) / len(history[-20:])
                item['above_20ma'] = close_val > avg_close_20
                avg_close_60 = sum(h["close"] for h in history[-60:]) / len(history[-60:])
                item['above_60ma'] = close_val > avg_close_60
                
        except Exception as e:
            print(f"  台指夜盤計算失敗: {e}")
        return item

    # 🚀 TWSE/TPEx 官方 API 大盤補償防禦機制，解決 yfinance 指數數據滯後問題
    import requests as _req
    
    # --- 執行台股與美股資料抓取 ---
    twii_data  = _tw_index('^TWII',  '加權指數')
    twoii_data = _tw_index('^TWOII', '櫃買指數')
    wtx_data   = _wtx_night_index()

    # 1. 補償加權指數 (^TWII)
    try:
        print("🔍 正在透過 TWSE 官方 API 驗證加權指數精準度...")
        res = _req.get("https://www.twse.com.tw/exchangeReport/FMTQIK?response=json", timeout=8)
        if res.status_code == 200:
            f_data = res.json()
            if 'data' in f_data and len(f_data['data']) > 0:
                last_row = f_data['data'][-1]
                raw_close = float(last_row[4].replace(',', ''))
                raw_diff = float(last_row[5].replace(',', ''))
                prev_close = raw_close - raw_diff
                pct_chg = round((raw_diff / prev_close) * 100, 2)
                
                if twii_data['close'] != raw_close:
                    print(f"  ⚠️ 偵測到 yfinance 加權數據滯後，已採用官方最新盤後數據覆蓋！")
                    twii_data['close'] = raw_close
                    twii_data['pct_chg'] = pct_chg
    except Exception as e_twii:
        print(f"  ⚠️ TWSE 官方加權指數補償失敗: {e_twii}")

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
                            raw_close = float(row[1].replace(',', ''))
                            pct_chg = float(row[3].replace(',', ''))
                            if twoii_data['close'] != raw_close:
                                print(f"  ⚠️ 偵測到 yfinance 櫃買數據滯後，已採用官方最新數據覆蓋！")
                                twoii_data['close'] = raw_close
                                twoii_data['pct_chg'] = pct_chg
                            break
    except Exception as e_otc:
        print(f"  ⚠️ TPEx 官方櫃買指數補償失敗: {e_otc}")

    # 3. 取得加權歷史量 (供向下相容舊大盤成交量欄位)
    vol_above_20ma = None
    vol_level = '普通'
    latest_vol_num = None
    try:
        hist_vol = yf.Ticker('^TWII').history(period='60d', interval='1d')
        if len(hist_vol) >= 20:
            valid_vols = hist_vol['Volume'][hist_vol['Volume'] > 0]
            vol_ma20 = float(valid_vols.rolling(20).mean().iloc[-1]) if len(valid_vols) >= 20 else 0
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
        print(f'  加權大盤量計算失敗: {e}')

    # --- 美股 ---
    us_indices = [
        _us_index('^SOX',  '費半 SOX'),
        _us_index('^NDX',  '那斯達克 100'),
        _us_index('^RUT',  '羅素 2000'),
        _us_index('^DJI',  '道瓊 DJI'),
        _us_index('^GSPC', 'S&P 500'),
        _us_index('^VIX',  'VIX 恐慌指數'),
    ]

    # ============================================
    # 計算新版市場健康度評分 (0 - 100 分)
    # ============================================
    
    # (A) 台股評分邏輯 (滿分 100)
    tw_score = 0
    for idx_data in [twii_data, twoii_data, wtx_data]:
        # 項目 1：漲跌超過 0.5% (+15分)
        if idx_data.get('pct_chg') is not None and abs(idx_data['pct_chg']) > 0.5:
            tw_score += 15
        # 項目 2：成交量大於均量 1.2 倍 (+15分)
        if idx_data.get('vol_ratio') is not None and idx_data['vol_ratio'] > 1.2:
            tw_score += 15
            
    # 項目 3：VIX 恐慌指數低於 20 (+10分)
    vix_data = next((x for x in us_indices if 'VIX' in x['label']), None)
    if vix_data and vix_data.get('close') is not None and vix_data['close'] < 20:
        tw_score += 10
        
    # (B) 美股評分邏輯 (滿分 100)
    us_score = 0
    for idx_data in [x for x in us_indices if 'VIX' not in x['label']]:
        # 項目 1：漲跌超過 0.5% (+10分)
        if idx_data.get('pct_chg') is not None and abs(idx_data['pct_chg']) > 0.5:
            us_score += 10
        # 項目 2：成交量大於均量 1.2 倍 (+10分)
        if idx_data.get('vol_ratio') is not None and idx_data['vol_ratio'] > 1.2:
            us_score += 10

    return {
        'tw': [twii_data, twoii_data, wtx_data],
        'vol_above_20ma': vol_above_20ma,
        'vol_level': vol_level,
        'latest_vol_num': latest_vol_num,
        'us': us_indices,
        'tw_health_score': tw_score,
        'us_health_score': us_score,
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

    # =====================================================
    # 新增：Supertrend (10, 3.0) 與 DMI (14) 計算
    # =====================================================
    # 1. Supertrend (10, 3.0)
    tr10 = df['tr']
    atr10 = pd.Series(index=tr10.index, dtype=float)
    if len(tr10) >= 10:
        atr10.iloc[9] = tr10.iloc[:10].mean()
        for i in range(10, len(tr10)):
            atr10.iloc[i] = (tr10.iloc[i] + 9 * atr10.iloc[i-1]) / 10.0
    else:
        atr10 = tr10.rolling(window=10, min_periods=1).mean()

    src = (df['high'] + df['low']) / 2
    up = src - (3.0 * atr10)
    dn = src + (3.0 * atr10)

    supertrend = pd.Series(1, index=df.index)
    final_up = pd.Series(up.fillna(0.0), index=df.index)
    final_dn = pd.Series(dn.fillna(0.0), index=df.index)

    start_idx = 10 if len(df) > 10 else 1
    for i in range(start_idx, len(df)):
        close_prev = df['close'].iloc[i-1]
        
        # Up
        up_curr = up.iloc[i]
        up_prev = final_up.iloc[i-1]
        final_up.iloc[i] = max(up_curr, up_prev) if close_prev > up_prev else up_curr
            
        # Dn
        dn_curr = dn.iloc[i]
        dn_prev = final_dn.iloc[i-1]
        final_dn.iloc[i] = min(dn_curr, dn_prev) if close_prev < dn_prev else dn_curr
            
        # Trend
        trend_prev = supertrend.iloc[i-1]
        if trend_prev == -1 and df['close'].iloc[i] > final_dn.iloc[i-1]:
            supertrend.iloc[i] = 1
        elif trend_prev == 1 and df['close'].iloc[i] < final_up.iloc[i-1]:
            supertrend.iloc[i] = -1
        else:
            supertrend.iloc[i] = trend_prev

    df['supertrend'] = supertrend

    # 2. DMI (14) 計算
    up_move = df['high'].diff()
    down_move = df['low'].shift(1) - df['low']
    
    plus_dm = pd.Series(0.0, index=df.index)
    minus_dm = pd.Series(0.0, index=df.index)
    
    mask_plus = (up_move > down_move) & (up_move > 0)
    plus_dm[mask_plus] = up_move[mask_plus]
    
    mask_minus = (down_move > up_move) & (down_move > 0)
    minus_dm[mask_minus] = down_move[mask_minus]

    def wilder_smooth(series, period=14):
        smoothed = pd.Series(index=series.index, dtype=float)
        if len(series) >= period:
            smoothed.iloc[period-1] = series.iloc[:period].mean()
            for idx in range(period, len(series)):
                smoothed.iloc[idx] = (series.iloc[idx] + (period - 1) * smoothed.iloc[idx-1]) / period
        else:
            smoothed = series.rolling(window=period, min_periods=1).mean()
        return smoothed

    tr_smoothed = wilder_smooth(df['tr'], 14)
    plus_dm_smoothed = wilder_smooth(plus_dm, 14)
    minus_dm_smoothed = wilder_smooth(minus_dm, 14)
    
    df['plus_di'] = 100 * (plus_dm_smoothed / (tr_smoothed + 1e-9))
    df['minus_di'] = 100 * (minus_dm_smoothed / (tr_smoothed + 1e-9))
    dx = 100 * ((df['plus_di'] - df['minus_di']).abs() / (df['plus_di'] + df['minus_di'] + 1e-9))
    df['adx'] = wilder_smooth(dx, 14)

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


def fetch_institutional_data_for_date(date_str):
    """
    抓取指定日期 (YYYYMMDD) 的上市與上櫃三大法人買賣超數據。
    若該日無交易或抓取失敗，回傳 None。
    """
    import datetime
    import time
    
    inst_data = {}
    
    # 1. 抓取上市 (TWSE)
    url = f"https://www.twse.com.tw/rwd/zh/fund/T86?date={date_str}&selectType=ALLBUT0999&response=json"
    try:
        res = requests.get(url, timeout=10)
        if res.status_code == 200:
            data = res.json()
            if data.get("stat") != "OK" or "data" not in data:
                return None
            
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
                    
            if foreign_idx == -1: foreign_idx = 4
            if trust_idx == -1: trust_idx = 10
            if dealer_idx == -1: dealer_idx = 11
            
            for row in data["data"]:
                code = row[0].strip()
                try:
                    foreign_val = int(row[foreign_idx].replace(",", "")) // 1000
                except:
                    foreign_val = 0
                try:
                    trust_val = int(row[trust_idx].replace(",", "")) // 1000
                except:
                    trust_val = 0
                try:
                    dealer_val = int(row[dealer_idx].replace(",", "")) // 1000
                except:
                    dealer_val = 0
                
                inst_data[code] = {
                    "foreign": foreign_val,
                    "trust": trust_val,
                    "dealer": dealer_val
                }
        else:
            return None
    except Exception as e:
        print(f"  抓取上市日期 {date_str} 出錯: {e}")
        return None
        
    time.sleep(0.5) # 遵守 API 頻率限制
    
    # 2. 既然上市有資料，對應去抓上櫃 (TPEx)
    try:
        dt_obj = datetime.datetime.strptime(date_str, "%Y%m%d")
        roc_year = dt_obj.year - 1911
        tpex_date_str = f"{roc_year}/{dt_obj.strftime('%m/%d')}"
    except Exception:
        return inst_data
        
    tpex_url = f"https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&t=D&d={tpex_date_str}&s=0,asc"
    try:
        res = requests.get(tpex_url, timeout=10)
        if res.status_code == 200:
            data = res.json()
            if "tables" in data and len(data["tables"]) > 0:
                table = data["tables"][0]
                if "data" in table:
                    for row in table["data"]:
                        if len(row) >= 23:
                            code = row[0].strip()
                            try:
                                foreign_val = int(row[4].replace(",", "")) // 1000
                            except:
                                foreign_val = 0
                            try:
                                trust_val = int(row[13].replace(",", "")) // 1000
                            except:
                                trust_val = 0
                            try:
                                dealer_val = int(row[22].replace(",", "")) // 1000
                            except:
                                dealer_val = 0
                            
                            if code in inst_data:
                                inst_data[code]["foreign"] = foreign_val
                                inst_data[code]["trust"] = trust_val
                                inst_data[code]["dealer"] = dealer_val
                            else:
                                inst_data[code] = {
                                    "foreign": foreign_val,
                                    "trust": trust_val,
                                    "dealer": dealer_val
                                }
    except Exception as e:
        print(f"  抓取上櫃日期 {tpex_date_str} 出錯: {e}")
        
    time.sleep(0.5)
    return inst_data


def fetch_institutional_data():
    """
    探測最新有資料的交易日，抓取其三大法人數據並回傳。
    回傳：(today_date_str, inst_data)
    """
    import datetime
    now = datetime.datetime.now()
    for i in range(10):
        d = now - datetime.timedelta(days=i)
        date_str = d.strftime("%Y%m%d")
        print(f"  正在探測最新的三大法人交易日資料 (上市/上櫃): {date_str}...")
        data = fetch_institutional_data_for_date(date_str)
        if data:
            print(f"  ✅ 成功取得 {date_str} 三大法人資料！共 {len(data)} 筆。")
            return date_str, data
    return None, {}


def update_institutional_history_and_calc_stats(today_date, today_data):
    """
    載入/維護本機歷史法人檔案，若天數不足 8 天則回溯補齊，
    最後計算出每檔股票：
    - instSum5D: 近 5 日（含今日）買超加總
    - instAvg7D: 近 7 日（不含今日）日均買超
    - instDetail5D: 近 5 日（含今日，由新到舊）每日法人合計買超明細
    """
    import datetime
    import os
    import json
    
    history_path = "scratch/institutional_history.json"
    history = {}
    if os.path.exists(history_path):
        try:
            with open(history_path, "r", encoding="utf-8") as rf:
                history = json.load(rf)
        except Exception as je:
            print(f"  讀取 institutional_history.json 失敗: {je}")
            
    # 更新今日數據
    if today_date and today_data:
        history[today_date] = today_data
        
    # 冷啟動防禦：若歷史天數少於 8 天，回溯抓取
    sorted_dates = sorted(list(history.keys()), reverse=True)
    if len(sorted_dates) < 8:
        print(f"  ⚠️ 檢測到三大法人歷史資料不足 8 天 (目前僅有 {len(sorted_dates)} 天)，啟動冷啟動歷史補齊機制...")
        now = datetime.datetime.now()
        for i in range(15):
            d = now - datetime.timedelta(days=i)
            date_str = d.strftime("%Y%m%d")
            if date_str not in history:
                print(f"  正在補抓歷史日期: {date_str}...")
                data = fetch_institutional_data_for_date(date_str)
                if data:
                    history[date_str] = data
                    print(f"  ✅ 成功補齊歷史 {date_str}，共 {len(data)} 筆")
                if len(history) >= 8:
                    break
        # 重新排序
        sorted_dates = sorted(list(history.keys()), reverse=True)
        
    # 保留最近 30 天，寫回檔案
    sorted_dates = sorted_dates[:30]
    history = {k: history[k] for k in sorted_dates}
    try:
        os.makedirs(os.path.dirname(history_path), exist_ok=True)
        with open(history_path, "w", encoding="utf-8") as wf:
            json.dump(history, wf, ensure_ascii=False, indent=2)
    except Exception as we:
        print(f"  寫入 institutional_history.json 失敗: {we}")
        
    today_key = sorted_dates[0] if sorted_dates else None
    dates_5d = sorted_dates[:5]
    dates_7d = sorted_dates[1:8] # 前 7 天，不含今天
    
    print(f"  📊 法人統計基準日：今日 = {today_key}，近5日 = {dates_5d}，近7日平均基底 = {dates_7d}")
    
    stats = {}
    all_codes = set()
    for d in sorted_dates:
        all_codes.update(history[d].keys())
        
    for code in all_codes:
        # 今日合計
        today_net = 0
        if today_key and code in history[today_key]:
            ti = history[today_key][code]
            today_net = (ti.get("foreign", 0) or 0) + (ti.get("trust", 0) or 0) + (ti.get("dealer", 0) or 0)
            
        # 近 5 日明細 (含今日)
        detail_5d = []
        for d in dates_5d:
            net = 0
            if code in history[d]:
                item = history[d][code]
                net = (item.get("foreign", 0) or 0) + (item.get("trust", 0) or 0) + (item.get("dealer", 0) or 0)
            detail_5d.append(net)
        sum_5d = sum(detail_5d)
        
        # 近 7 日平均 (不含今日)
        nets_7d = []
        for d in dates_7d:
            if code in history[d]:
                item = history[d][code]
                net = (item.get("foreign", 0) or 0) + (item.get("trust", 0) or 0) + (item.get("dealer", 0) or 0)
                nets_7d.append(net)
            else:
                nets_7d.append(0)
                
        avg_7d = round(sum(nets_7d) / 7.0, 1) if nets_7d else 0.0
        
        stats[code] = {
            "instSum5D": sum_5d,
            "instAvg7D": avg_7d,
            "instDetail5D": detail_5d
        }
        
    return stats


def run_screener():
    print("載入 TWSE/TPEX OpenAPI 全市場資訊以計算合併市值前 500 大標的...")
    all_market_info = load_all_market_info()

    # 載入個股產業分類對照表 CSV（產業,分類,股票代碼,股票名稱）
    industry_map = {}  # code -> "產業:分類"
    try:
        import csv
        base_dir_ind = os.path.dirname(os.path.abspath(__file__))
        ind_csv_path = os.path.join(base_dir_ind, '個股產業分類對照表.csv')
        with open(ind_csv_path, encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            for row in reader:
                code = str(row.get('股票代碼', '')).strip().zfill(4)
                cat1 = row.get('產業', '').strip()
                cat2 = row.get('分類', '').strip()
                if code:
                    industry_map[code] = f"{cat1}:{cat2}"
        print(f"✅ 載入產業對照表完成，共 {len(industry_map)} 筆分類")
    except Exception as e:
        print(f"⚠️ 產業對照表載入失敗: {e}")
    
    # 1. 批量抓取官方 OpenAPI 基本面數據 (營收YoY、毛利率、負債比、股本)
    openapi_fund = fetch_openapi_fundamentals()
    
    # 2. 計算全台股「合併市值前 500 名」
    mkt_cap_list = []
    for code, info in all_market_info.items():
        # 過濾權證與非普通股 (代碼長度為 4 或 5 且開頭為數字，容納 0050 等)
        if (len(code) == 4 or len(code) == 5) and code.isdigit():
            # 取得股本 (以元為單位)
            fund_data = openapi_fund.get(code, {})
            capital = fund_data.get('capital')
            
            # 取得昨日收盤價
            close_price = safe_float(info.get('ClosingPrice') or info.get('Close'))
            
            if capital and close_price:
                # 市值 = 股本 / 10 * 收盤價 (股本為元，面額10元，故除以10換算為股數)
                mkt_cap = (capital / 10) * close_price
                mkt_cap_list.append({
                    'Code': code,
                    'Name': info.get('Name') or info.get('CompanyName'),
                    'mkt_cap': mkt_cap
                })
    
    # 依市值降序排列，取前 1000 大切片以解決 Vercel 100MB 部署限制，但自選股依然會加入
    mkt_cap_list.sort(key=lambda x: x['mkt_cap'], reverse=True)
    top_500_stocks = [{'Code': item['Code'], 'Name': item['Name']} for item in mkt_cap_list[:1000]]
    print(f"📊 成功篩選出合併市值前 1000 大個股 (最大: {mkt_cap_list[0]['Name']} - 市值: {mkt_cap_list[0]['mkt_cap']/1e8:.1f}億)！")
    
    # 3. 讀取 CSV 作為自選觀察清單與前 500 大合併去重
    base_dir = os.path.dirname(os.path.abspath(__file__))
    csv_path = os.path.join(base_dir, "股票分析清單.csv")
    csv_stocks = read_stock_list_from_csv(csv_path)
    
    # 合併去重邏輯
    final_stocks_map = {item['Code']: item for item in top_500_stocks}
    added_count = 0
    for s in csv_stocks:
        code = s['Code']
        if code not in final_stocks_map:
            final_stocks_map[code] = s
            added_count += 1
            
    csv_stocks = list(final_stocks_map.values())
    print(f"🔗 合併完成！前 500 大股票加上 CSV 專屬自選股，共計分析 {len(csv_stocks)} 檔標的 (額外疊加自選: {added_count} 檔)！")
        
    print("下載三大法人當日買賣超資料...")
    today_date, inst_today = fetch_institutional_data()
    inst_stats = update_institutional_history_and_calc_stats(today_date, inst_today)
    
    # 為了與舊代碼相容，建立 inst_data 變數
    inst_data = inst_today
    
    # 批量抓取官方 OpenAPI 基本面數據 (如果上面沒抓過的話)
    if 'openapi_fund' not in locals():
        openapi_fund = fetch_openapi_fundamentals()
    
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
            df_all = yf.download(tickers, period='250d', group_by='ticker', threads=20, timeout=15)
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

            # 漲跌幅：優先使用 OpenAPI 提供的漲跌額（Change）來計算，最精準
            # 若 OpenAPI 無漲跌額，再退回 K 線倒數兩筆計算
            try:
                openapi_change_raw = s.get('Change', '')  # TWSE/OTC 的漲跌額（元，字串）
                openapi_change_val = safe_float(str(openapi_change_raw).replace('+', '').strip()) if openapi_change_raw else None
                if openapi_change_val is not None and close and close > 0:
                    # 昨收 = 今收 - 漲跌額
                    prev_close_calc = close - openapi_change_val
                    if prev_close_calc > 0:
                        change_num = round((openapi_change_val / prev_close_calc) * 100, 2)
                    else:
                        change_num = 0.0
                else:
                    # Fallback：用 K 線倒數兩筆計算
                    latest_date_str = latest['date']
                    today_str = pd.Timestamp.now(tz='Asia/Taipei').strftime('%Y-%m-%d')
                    if latest_date_str == today_str:
                        prev_close = float(prev['close'])
                    else:
                        prev_close = float(latest['close'])
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

            # 三大法人統計數據
            code_stats = inst_stats.get(symbol, {"instSum5D": 0, "instAvg7D": 0.0, "instDetail5D": [0, 0, 0, 0, 0]})
            inst_sum_5d = code_stats["instSum5D"]
            inst_avg_7d = code_stats["instAvg7D"]
            inst_detail_5d = code_stats["instDetail5D"]

            # 新增技術指標 Supertrend 與 DMI
            supertrend_val = int(latest['supertrend']) if 'supertrend' in latest else 1
            prev_supertrend_val = int(prev['supertrend']) if 'supertrend' in prev else 1
            plus_di_val = round(float(latest['plus_di']), 2) if 'plus_di' in latest else 0.0
            minus_di_val = round(float(latest['minus_di']), 2) if 'minus_di' in latest else 0.0
            adx_val = round(float(latest['adx']), 2) if 'adx' in latest else 0.0

            results.append({
                "id": symbol, "name": name, "market": market,
                "industry": industry_map.get(str(symbol).zfill(4), ''),
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
                "instSum5D": inst_sum_5d,
                "instAvg7D": inst_avg_7d,
                "instDetail5D": inst_detail_5d,
                "supertrend": supertrend_val,
                "prev_supertrend": prev_supertrend_val,
                "plus_di": plus_di_val,
                "minus_di": minus_di_val,
                "adx": adx_val,
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

    # === 新增：計算族群強弱排行歷史 ===
    sector_groups = {}
    for s in results:
        ind_str = s.get("industry", "")
        sector = ind_str.split(":")[1] if ":" in ind_str else ind_str
        if not sector:
            sector = "一般"
        if sector not in sector_groups:
            sector_groups[sector] = []
        sector_groups[sector].append(s.get("change", 0.0) or 0.0)
        
    sector_avg = []
    for sector, changes in sector_groups.items():
        avg_chg = sum(changes) / len(changes) if changes else 0.0
        sector_avg.append({"name": sector, "avgChange": avg_chg})
        
    # 強勢族群 (降序)
    sector_avg.sort(key=lambda x: x["avgChange"], reverse=True)
    strong_sectors = [x["name"] for x in sector_avg[:15]]
    # 弱勢族群 (升序)
    sector_avg.sort(key=lambda x: x["avgChange"])
    weak_sectors = [x["name"] for x in sector_avg[:15]]

    sec_history_path = "scratch/sector_history.json"
    sec_history = []
    if os.path.exists(sec_history_path):
        try:
            with open(sec_history_path, "r", encoding="utf-8") as rf:
                sec_history = json.load(rf)
        except Exception:
            pass
            
    today_str = pd.Timestamp.now(tz='Asia/Taipei').strftime('%Y-%m-%d')
    existing_today = [x for x in sec_history if x.get("date") == today_str]
    if not existing_today:
        sec_history.append({
            "date": today_str,
            "strong": strong_sectors,
            "weak": weak_sectors
        })
    else:
        for x in sec_history:
            if x["date"] == today_str:
                x["strong"] = strong_sectors
                x["weak"] = weak_sectors
                
    sec_history.sort(key=lambda x: x.get("date", ""), reverse=True)
    sec_history = sec_history[:30] # 保留最近 30 天
    
    try:
        os.makedirs(os.path.dirname(sec_history_path), exist_ok=True)
        with open(sec_history_path, "w", encoding="utf-8") as wf:
            json.dump(sec_history, wf, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"寫入 sector_history.json 失敗: {e}")

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
        "tw_health_score": market_health['tw_health_score'],
        "us_health_score": market_health['us_health_score'],
        # 向下相容舊欄位（避免 JS 舊引用爆炸）
        "twii_above_60ma": bool(market_health['twii']),
        "otc_above_60ma":  bool(market_health['otc']),
        "vol_above_20ma_bool": bool(market_health['vol']),
        "lastUpdate": now_str,
        "price_failed_stocks": price_failed_stocks,
        "sectorHistory": sec_history
    }

    # ── 1. 預計算 RankingsData ──
    sectors_map = {}
    for s in results:
        ind_str = s.get("industry", "")
        sector = ind_str.split(":")[1] if ":" in ind_str else ind_str
        if not sector:
            sector = "一般"
        sectors_map.setdefault(sector, []).append(s)

    sectors_calc = []
    for sname, s_list in sectors_map.items():
        total_vol = sum((st.get('dailyVol', 0) or 0) * 1000 * (st.get('price', 0) or 0) for st in s_list)
        sum_chg = sum(st.get('change', 0) or 0 for st in s_list)
        avg_chg = sum_chg / len(s_list) if s_list else 0
        
        tot_inst = sum((st.get('trustDays', 0) or 0) + (st.get('foreignNetBuy', 0) or 0) + (st.get('dealerDays', 0) or 0) for st in s_list)
        tot_inst_5d = sum(st.get('instSum5D', 0) or 0 for st in s_list)
        
        sum_chg_5d = 0
        for st in s_list:
            kline = st.get('kline', [])
            if len(kline) >= 6:
                close_t = st.get('price') or kline[-1]['close']
                close_p = kline[-6]['close']
                sum_chg_5d += ((close_t - close_p) / close_p * 100) if close_p > 0 else 0
            else:
                sum_chg_5d += (st.get('change', 0) or 0) * 5
        avg_chg_5d = sum_chg_5d / len(s_list) if s_list else 0

        simplified_stocks = []
        for st in s_list:
            simplified_stocks.append({
                "id": st["id"],
                "name": st["name"],
                "change": st["change"],
                "volRatio": st["volRatio"],
                "trustDays": st["trustDays"],
                "foreignNetBuy": st["foreignNetBuy"],
                "dealerDays": st["dealerDays"]
            })

        sectors_calc.append({
            "name": sname,
            "totalVol": total_vol,
            "avgChange": avg_chg,
            "avgChange5D": avg_chg_5d,
            "totalInst": tot_inst,
            "totalInst5D": tot_inst_5d,
            "stocks": simplified_stocks
        })

    rank_limit = 15
    strong_list = sorted(sectors_calc, key=lambda x: x["avgChange"], reverse=True)[:rank_limit]
    weak_list = sorted(sectors_calc, key=lambda x: x["avgChange"])[:rank_limit]
    hot_list = sorted(results, key=lambda x: x.get("volRatio", 0), reverse=True)[:rank_limit]
    
    inst_stocks = [s for s in results if ((s.get("trustDays", 0) or 0) + (s.get("foreignNetBuy", 0) or 0) + (s.get("dealerDays", 0) or 0)) > 0]
    inst_list = sorted(inst_stocks, key=lambda x: x.get("volRatio", 0), reverse=True)[:rank_limit]
    
    dip_stocks = []
    for s in results:
        change_val = s.get("change", 0)
        inst_today = (s.get("trustDays", 0) or 0) + (s.get("foreignNetBuy", 0) or 0) + (s.get("dealerDays", 0) or 0)
        cond_vol = s.get("volRatio", 0) >= 1.25
        cond_inst = inst_today > 0 and change_val >= -5.0
        cond_price = change_val >= -5.0 and change_val <= 1.5
        cond_st = s.get("prev_supertrend") == -1 and s.get("supertrend") == 1
        cond_dmi = s.get("plus_di", 0) > s.get("minus_di", 0) and s.get("adx", 0) > 25
        if cond_vol and cond_inst and cond_price and cond_st and cond_dmi:
            dip_stocks.append(s)
    dip_list = sorted(dip_stocks, key=lambda x: x.get("volRatio", 0), reverse=True)[:rank_limit]

    def clean_rank_stock(s_dict):
        return {
            "id": s_dict["id"],
            "name": s_dict["name"],
            "change": s_dict["change"],
            "volRatio": s_dict["volRatio"],
            "trustDays": s_dict["trustDays"],
            "foreignNetBuy": s_dict["foreignNetBuy"],
            "dealerDays": s_dict["dealerDays"],
            "instSum5D": s_dict.get("instSum5D", 0)
        }

    rankings_data = {
        "strong": [{"name": g["name"], "avgChange": g["avgChange"], "avgChange5D": g["avgChange5D"], "totalInst": g["totalInst"], "totalInst5D": g["totalInst5D"], "stocks": g["stocks"]} for g in strong_list],
        "weak": [{"name": g["name"], "avgChange": g["avgChange"], "avgChange5D": g["avgChange5D"], "totalInst": g["totalInst"], "totalInst5D": g["totalInst5D"], "stocks": g["stocks"]} for g in weak_list],
        "hot": [clean_rank_stock(s) for s in hot_list],
        "inst": [clean_rank_stock(s) for s in inst_list],
        "dip": [clean_rank_stock(s) for s in dip_list]
    }

    # ── 2. 預計算 BroadcastData ──
    top_strong_3 = sorted(sectors_calc, key=lambda x: x["avgChange"], reverse=True)[:4]
    strong_sec_text = ""
    if top_strong_3:
        strong_sec_text = "、".join([f"🔥 <strong style='color:white;'>{g['name']}</strong> (已強勢 {get_sector_streak_days_py(g['name'], 'strong', sec_history)} 天)" for g in top_strong_3])
    else:
        strong_sec_text = "<span style='color:var(--text-muted);'>今日無明顯強勢產業汪。</span>"

    turn_strong_text = "<span style='color:var(--text-muted);'>無明顯由弱轉強產業汪。</span>"
    turn_weak_text = "<span style='color:var(--text-muted);'>大盤穩健，無轉弱產業要注意汪。</span>"
    if len(sec_history) >= 2:
        yesterday_strong = sec_history[1].get("strong", [])
        yesterday_weak = sec_history[1].get("weak", [])
        today_top5_strong = [g["name"] for g in sorted(sectors_calc, key=lambda x: x["avgChange"], reverse=True)[:5]]
        today_top5_weak = [g["name"] for g in sorted(sectors_calc, key=lambda x: x["avgChange"])[:5]]
        
        turn_strong_s = [s for s in today_top5_strong if s in yesterday_weak]
        if turn_strong_s:
            turn_strong_text = "、".join([f"<span style='color:var(--success); font-weight:bold;'>✨ {s}</span>" for s in turn_strong_s])
            
        turn_weak_s = [s for s in today_top5_weak if s in yesterday_strong]
        if turn_weak_s:
            turn_weak_text = "、".join([f"<span style='color:var(--danger); font-weight:bold;'>⚠️ {s}</span>" for s in turn_weak_s])

    broadcast_data = {
        "strongSectorsText": strong_sec_text,
        "turnStrongText": turn_strong_text,
        "turnWeakText": turn_weak_text
    }

    # ── 3. 預計算 BubbleChartData ──
    bubble_sectors = []
    for g in sectors_calc:
        net_flow_1d = 0
        net_flow_5d = 0
        
        for st in g["stocks"]:
            full_s = next((x for x in results if x["id"] == st["id"]), None)
            if not full_s: continue
            
            amount = (full_s.get("dailyVol", 0) or 0) * 1000 * (full_s.get("price", 0) or 0)
            chg = full_s.get("change", 0) or 0
            today_flow = (amount * (chg / 100)) / 1e8
            
            stock_flow_5d = 0
            kline = full_s.get("kline", [])
            if len(kline) >= 6:
                for i in range(len(kline) - 5, len(kline)):
                    if kline[i] and kline[i-1]:
                        close_c = float(kline[i]["close"]) or 0.0
                        close_p = float(kline[i-1]["close"]) or 0.0
                        vol_c = float(kline[i]["volume"]) or 0.0
                        c_chg = (close_c - close_p) / close_p if close_p > 0 else 0.0
                        c_amount = vol_c * close_c
                        stock_flow_5d += (c_amount * c_chg)
                stock_flow_5d = stock_flow_5d / 1e8
            else:
                stock_flow_5d = today_flow * 5
                
            net_flow_1d += today_flow
            net_flow_5d += stock_flow_5d

        bubble_sectors.append({
            "name": g["name"],
            "netFlow": round(net_flow_1d, 3),
            "netFlow5D": round(net_flow_5d, 3),
            "totalVol": g["totalVol"],
            "avgChange": g["avgChange"],
            "stocks": [{
                "id": st["id"],
                "name": st["name"],
                "change": st["change"],
                "volRatio": st["volRatio"],
                "instToday": (st.get("trustDays", 0) or 0) + (st.get("foreignNetBuy", 0) or 0) + (st.get("dealerDays", 0) or 0)
            } for st in g["stocks"]]
        })

    bubble_chart_data = {
        "sectors": bubble_sectors
    }

    # 隱私保護：對 results 進行個股機密欄位清理
    # 原則：隱去計算公式與策略邏輯，但保留「結果類」欄位供前端篩選表格顯示
    cleaned_mock_stocks = []
    for s in results:
        cleaned_mock_stocks.append({
            # === 基本識別 ===
            "id": s["id"],
            "name": s["name"],
            "market": s.get("market", "TSE"),
            "industry": s.get("industry", ""),
            # === 價格與量能 ===
            "price": s["price"],
            "change": s["change"],
            "dailyVol": s["dailyVol"],
            "volRatio": s["volRatio"],
            "turnover": s.get("turnover"),
            "marketCap": s.get("marketCap"),
            # === 基本面結果值（已計算完成，不含公式）===
            "eps": s.get("eps"),
            "epsYoY": s.get("epsYoY"),
            "revYoY": s.get("revYoY"),
            "roe": s.get("roe"),
            "grossMargin": s.get("grossMargin"),
            "debtRatio": s.get("debtRatio"),
            # === 法人籌碼結果值 ===
            "trustDays": s.get("trustDays"),
            "foreignBuy": s.get("foreignBuy"),
            "foreignNetBuy": s.get("foreignNetBuy"),
            "dealerDays": s.get("dealerDays"),
            "instSum5D": s.get("instSum5D", 0),
            "instAvg7D": s.get("instAvg7D", 0),
            "instDetail5D": s.get("instDetail5D", [0,0,0,0,0]),
            # === 技術指標結果值 ===
            "maBull": s.get("maBull"),
            "ma20Rising": s.get("ma20Rising"),
            "closeToHigh": s.get("closeToHigh"),
            "dist52W": s.get("dist52W"),
            "rsi14": s.get("rsi14"),
            "type": s.get("type", ""),
            # === K 線（供前端回測）===
            "kline": s["kline"]
        })

    json_data = {
        "marketData": market_data_dict,
        "rulesConfig": rules,
        "rankingsData": rankings_data,
        "broadcastData": broadcast_data,
        "bubbleChartData": bubble_chart_data,
        "mockStocks": cleaned_mock_stocks
    }

    # 🚀 深度清理 NaN 與 Infinity，保證輸出符合標準 JSON 規範 (防範瀏覽器 JSON.parse 崩潰)
    import math
    def clean_nan(obj):
        if isinstance(obj, dict):
            return {k: clean_nan(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [clean_nan(x) for x in obj]
        elif isinstance(obj, float):
            if math.isnan(obj) or math.isinf(obj):
                return None
            return obj
        return obj

    cleaned_json_data = clean_nan(json_data)

    with open('data.json', 'w', encoding='utf-8') as f:
        json.dump(cleaned_json_data, f, ensure_ascii=False, indent=2)

    # 同步輸出 data.js 供前端直接引入與後端狀態檢查使用
    with open('data.js', 'w', encoding='utf-8') as f:
        f.write(f"// 由 yfinance 產生之真實資料 — {now_str}\n")
        f.write("const marketData = ")
        json.dump(cleaned_json_data, f, ensure_ascii=False, indent=2)
        f.write(";\n")

    print(f"\n==========================================")
    print(f"🎉 執行完畢！")
    print(f"👉 成功產出 {len(results)} 檔。")
    if price_failed_stocks:
        print(f"\033[93m⚠️  警告：共有 {len(price_failed_stocks)} 檔股票無法讀取價格！\033[0m")
        print(f"已覆寫 data.json 與 data.js 並記錄失敗標的。")
    print(f"==========================================\n")

    # 自動 git commit + push，讓 Vercel 同步更新雲端網站
    try:
        import subprocess as _sp
        _sp.run(['git', 'add', 'data.json', 'data.js'], check=True)
        # 用 try commit 加上 --allow-empty 避免沒有變更時報錯
        _sp.run(['git', 'commit', '--allow-empty', '-m', f'data: 自動更新選股數據 {now_str}'], check=True)
        
        # 🚀 防禦機制：推送前先做 pull --rebase，並在衝突時優先使用我們本地新產出的資料，避免 rejected
        print("🔄 正在拉取遠端最新狀態以防止 Git 衝突...")
        _sp.run(['git', 'pull', '--rebase', '-X', 'ours', 'origin', 'main'], check=True)
        
        _sp.run(['git', 'push', 'origin', 'main'], check=True)
        print("✅ data.json 與 data.js 已自動推送至 GitHub，Vercel 雲端網站將在約 30 秒內同步更新！")
    except Exception as git_err:
        print(f"⚠️  自動 git push 失敗（不影響本機使用）：{git_err}")


if __name__ == "__main__":
    run_screener()
