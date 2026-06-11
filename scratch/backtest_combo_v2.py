import datetime
import requests
import time
import os
import json
import re

def get_recent_3_days_data():
    """
    抓取上市與上櫃最近三個有效交易日的三大法人數據
    """
    now = datetime.datetime.now()
    dates_to_check = []
    for i in range(15):
        d = now - datetime.timedelta(days=i)
        dates_to_check.append(d)
        
    twse_valid_days = []
    tpex_valid_days = []
    twse_daily_data = {}
    tpex_daily_data = {}
    
    downloaded = 0
    for d in dates_to_check:
        if downloaded >= 3:
            break
        date_str = d.strftime("%Y%m%d")
        url = f"https://www.twse.com.tw/rwd/zh/fund/T86?date={date_str}&selectType=ALLBUT0999&response=json"
        try:
            res = requests.get(url, timeout=10)
            if res.status_code == 200:
                data = res.json()
                if data.get("stat") == "OK" and "data" in data:
                    twse_valid_days.append(date_str)
                    twse_daily_data[date_str] = {}
                    
                    fields = data.get("fields", [])
                    foreign_idx = 4
                    trust_idx = 10
                    for f_idx, field in enumerate(fields):
                        if "外陸資" in field and "買賣超" in field and "不含外資自營商" in field:
                            foreign_idx = f_idx
                        elif "投信" in field and "買賣超" in field:
                            trust_idx = f_idx
                            
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
                        twse_daily_data[date_str][code] = {"foreign": foreign_val, "trust": trust_val}
                    downloaded += 1
            time.sleep(0.1)
        except Exception:
            pass
            
    downloaded = 0
    for d in dates_to_check:
        if downloaded >= 3:
            break
        roc_year = d.year - 1911
        date_str_roc = f"{roc_year}/{d.strftime('%m/%d')}"
        date_str_key = d.strftime("%Y%m%d")
        url = f"https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&se=EW&d={date_str_roc}"
        try:
            res = requests.get(url, timeout=10)
            if res.status_code == 200:
                data = res.json()
                if data.get("aaData") and len(data["aaData"]) > 0:
                    tpex_valid_days.append(date_str_key)
                    tpex_daily_data[date_str_key] = {}
                    
                    for row in data["aaData"]:
                        code = row[0].strip()
                        try:
                            trust_val = int(row[7].replace(",", "")) // 1000
                        except:
                            trust_val = 0
                        try:
                            foreign_val = int(row[10].replace(",", "")) // 1000
                        except:
                            foreign_val = 0
                        tpex_daily_data[date_str_key][code] = {"foreign": foreign_val, "trust": trust_val}
                    downloaded += 1
            time.sleep(0.1)
        except Exception:
            pass

    res_map = {}
    all_codes = set()
    for d_data in list(twse_daily_data.values()) + list(tpex_daily_data.values()):
        all_codes.update(d_data.keys())
        
    for code in all_codes:
        is_twse = False
        foreign_buys = []
        trust_buys = []
        for day in twse_valid_days:
            if code in twse_daily_data[day]:
                is_twse = True
                foreign_buys.append(twse_daily_data[day][code]["foreign"])
                trust_buys.append(twse_daily_data[day][code]["trust"])
                
        if not is_twse:
            for day in tpex_valid_days:
                if code in tpex_daily_data[day]:
                    foreign_buys.append(tpex_daily_data[day][code]["foreign"])
                    trust_buys.append(tpex_daily_data[day][code]["trust"])
                    
        is_foreign_consecutive_3 = len(foreign_buys) >= 3 and all(v > 0 for v in foreign_buys[:3])
        is_trust_consecutive_3 = len(trust_buys) >= 3 and all(v > 0 for v in trust_buys[:3])
        
        if is_foreign_consecutive_3 or is_trust_consecutive_3:
            res_map[code] = {
                "foreign_consecutive_3": is_foreign_consecutive_3,
                "trust_consecutive_3": is_trust_consecutive_3,
                "foreign_detail": foreign_buys[:3],
                "trust_detail": trust_buys[:3]
            }
    return res_map

def calculate_atr(kline, period=14):
    tr = []
    for i in range(len(kline)):
        high = float(kline[i]['high'])
        low = float(kline[i]['low'])
        if i == 0:
            tr.append(high - low)
        else:
            prev_close = float(kline[i-1]['close'])
            tr.append(max(high - low, abs(high - prev_close), abs(low - prev_close)))
    atr = [None] * len(kline)
    if len(kline) < period:
        return atr
    atr_sum = sum(tr[:period])
    atr[period - 1] = atr_sum / period
    for i in range(period, len(kline)):
        atr[i] = (atr[i-1] * (period - 1) + tr[i]) / period
    return atr

def calculate_supertrend(kline, period=10, multiplier=3):
    atr = calculate_atr(kline, period)
    supertrend = []
    up = [0.0] * len(kline)
    dn = [0.0] * len(kline)
    trend = [1] * len(kline)
    
    for i in range(len(kline)):
        if i < period - 1:
            supertrend.append({'value': None, 'trend': 1})
            continue
        src = (float(kline[i]['high']) + float(kline[i]['low'])) / 2.0
        curr_atr = atr[i]
        basic_up = src - multiplier * curr_atr
        basic_dn = src + multiplier * curr_atr
        
        if i == period - 1:
            up[i] = basic_up
            dn[i] = basic_dn
            trend[i] = 1
            supertrend.append({'value': basic_up, 'trend': 1})
            continue
            
        prev_up = up[i-1]
        prev_dn = dn[i-1]
        prev_close = float(kline[i-1]['close'])
        
        if prev_close > prev_up:
            up[i] = max(basic_up, prev_up)
        else:
            up[i] = basic_up
            
        if prev_close < prev_dn:
            dn[i] = min(basic_dn, prev_dn)
        else:
            dn[i] = basic_dn
            
        prev_trend = trend[i-1]
        curr_close = float(kline[i]['close'])
        
        if prev_trend == 1 and curr_close < up[i]:
            trend[i] = -1
        elif prev_trend == -1 and curr_close > dn[i]:
            trend[i] = 1
        else:
            trend[i] = prev_trend
            
        val = up[i] if trend[i] == 1 else dn[i]
        supertrend.append({'value': val, 'trend': trend[i]})
    return supertrend

def run_evaluation():
    # 載入 data.js 的 mockStocks
    base_dir = os.path.dirname(os.path.abspath(__file__))
    data_path = os.path.join(base_dir, '../data.js')
    content = open(data_path, encoding='utf-8').read()
    
    match = re.search(r'const\s+mockStocks\s*=\s*(\[[\s\S]*?\]);\s*(?://|$)', content)
    if not match:
        print("無法解析 mockStocks")
        return
        
    mock_stocks = json.loads(match.group(1))
    print(f"成功載入 {len(mock_stocks)} 檔標的資料。")
    
    # 獲取法人連買
    inst_map = get_recent_3_days_data()
    
    backtest_results = []
    current_matching = []
    
    for stock in mock_stocks:
        kline = stock.get('kline', [])
        if len(kline) < 100:
            continue
            
        symbol = str(stock['id']).zfill(4)
        atr = calculate_atr(kline, 14)
        st = calculate_supertrend(kline, 10, 3)
        
        for i in range(60, len(kline)):
            # 條件 1：ATR 壓縮 (前一日 ATR 壓縮至 30% 內)
            max_atr = 0.0
            has_atr = True
            for j in range(2, 62):
                if atr[i-j] is None:
                    has_atr = False
                    break
                if atr[i-j] > max_atr:
                    max_atr = atr[i-j]
            if not has_atr or max_atr == 0:
                continue
                
            prev_atr = atr[i-1]
            if prev_atr is None or prev_atr > max_atr * 0.3:
                continue
                
            # 條件 2：Supertrend 剛轉 Up-trend
            st_curr = st[i]
            st_prev = st[i-1]
            if not st_curr or not st_prev or st_curr['trend'] != 1 or st_prev['trend'] != -1:
                continue
                
            # 這檔股票在當天符合「前日ATR壓縮<=30% + Supertrend剛轉多」
            is_last = (i == len(kline) - 1)
            close = float(kline[i]['close'])
            
            if is_last:
                # 如果是最後一天，我們再對照法人連買 3 天的資料
                if symbol in inst_map:
                    current_matching.append({
                        'id': symbol,
                        'name': stock['name'],
                        'price': close,
                        'change': stock['change'],
                        'atr_ratio': f"{prev_atr / max_atr * 100:.1f}%",
                        'inst': inst_map[symbol]
                    })
            else:
                # 歷史回測數據收集
                ret5 = (float(kline[i+5]['close']) - close) / close if i + 5 < len(kline) else None
                ret10 = (float(kline[i+10]['close']) - close) / close if i + 10 < len(kline) else None
                ret20 = (float(kline[i+20]['close']) - close) / close if i + 20 < len(kline) else None
                
                backtest_results.append({
                    'symbol': symbol,
                    'name': stock['name'],
                    'date': kline[i].get('date', kline[i].get('time')),
                    'ret5': ret5,
                    'ret10': ret10,
                    'ret20': ret20
                })

    # 計算統計數據
    def get_stats(results, key):
        valid = [r for r in results if r[key] is not None]
        if not valid:
            return 0, "--", "--"
        win = [r for r in valid if r[key] > 0]
        avg = sum(r[key] for r in valid) / len(valid)
        win_rate = len(win) / len(valid)
        return len(valid), f"{avg*100:.2f}%", f"{win_rate*100:.2f}%"

    print("\n=================== 📊 技術面基準回測統計結果 ===================")
    print("條件：前一日 ATR 壓縮 <= 30% + Supertrend 本日剛轉黃金交叉")
    for p in [5, 10, 20]:
        n, avg_ret, win = get_stats(backtest_results, f'ret{p}')
        print(f"持有 {p:2d} 天 ── 樣本數: {n:4d} | 平均報酬率: {avg_ret} | 勝率: {win}")
        
    print("\n=================== 🎯 今日符合所有條件之台股標的 ===================")
    print("條件：技術面符合 + 外資或投信最近連續 3 天均為買超 (Net > 0)")
    if not current_matching:
        print("今日無任何標的同時符合 [技術面剛突破] 與 [法人連續買超 3 天] 條件。")
    else:
        for s in current_matching:
            inst = s['inst']
            inst_type = []
            if inst['foreign_consecutive_3']: inst_type.append("外資連3買")
            if inst['trust_consecutive_3']: inst_type.append("投信連3買")
            
            f_detail = ", ".join(f"{x}張" for x in inst['foreign_detail'])
            t_detail = ", ".join(f"{x}張" for x in inst['trust_detail'])
            
            print(f"[{s['id']} {s['name']}] 收盤價: {s['price']} 元 | 今日漲跌: {s['change']}%")
            print(f"   └ 前日ATR壓縮度: {s['atr_ratio']} | 法人狀態: {' & '.join(inst_type)}")
            print(f"   └ 近 3 日外資買超明細: [{f_detail}] (最新 -> 最舊)")
            print(f"   └ 近 3 日投信買超明細: [{t_detail}] (最新 -> 最舊)")
    print("================================================================")

if __name__ == "__main__":
    run_evaluation()
