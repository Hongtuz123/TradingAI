import datetime
import requests
import time
import os
import json

def get_recent_3_days_data():
    """
    抓取上市與上櫃最近三個有效交易日的三大法人數據
    回傳一個 dict: { '股票代碼': { 'foreign_days': 0~3, 'trust_days': 0~3 } }
    表示最近 3 天中，連續買超了幾天 (必須是最近連續 3 天都買超，或者回推連續買超)
    這裡直接檢查：是否第 t、t-1、t-2 天皆為買超。
    """
    now = datetime.datetime.now()
    dates_to_check = []
    for i in range(15):  # 回溯 15 天以防假日或週休
        d = now - datetime.timedelta(days=i)
        dates_to_check.append(d)
        
    twse_valid_days = []
    tpex_valid_days = []
    
    # 儲存每天的法人買賣超資料
    # 格式: { date_str: { symbol: { 'foreign': net, 'trust': net } } }
    twse_daily_data = {}
    tpex_daily_data = {}
    
    # 1. 抓取上市 (TWSE) 最近 3 個交易日
    print("正在下載最近 3 個交易日的上市三大法人資料...")
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
                    print(f"  成功取得上市 {date_str} 資料")
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
            time.sleep(0.5)
        except Exception as e:
            print(f"  上市 {date_str} 抓取失敗: {e}")
            
    # 2. 抓取上櫃 (TPEx) 最近 3 個交易日
    print("正在下載最近 3 個交易日的上櫃三大法人資料...")
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
                    print(f"  成功取得上櫃 {date_str_roc} 資料")
                    tpex_valid_days.append(date_str_key)
                    tpex_daily_data[date_str_key] = {}
                    
                    for row in data["aaData"]:
                        code = row[0].strip()
                        try:
                            # 投信買賣超股數在第 8 欄 (0-based)
                            trust_val = int(row[7].replace(",", "")) // 1000
                        except:
                            trust_val = 0
                        try:
                            # 外資買賣超股數在第 11 欄 (0-based)
                            foreign_val = int(row[10].replace(",", "")) // 1000
                        except:
                            foreign_val = 0
                        tpex_daily_data[date_str_key][code] = {"foreign": foreign_val, "trust": trust_val}
                    downloaded += 1
            time.sleep(0.5)
        except Exception as e:
            print(f"  上櫃 {date_str_roc} 抓取失敗: {e}")

    # 合併分析
    # 計算每檔股票是否最近 3 天外資或投信連續買超
    res_map = {}
    
    # 取得所有的股票代碼
    all_codes = set()
    for d_data in list(twse_daily_data.values()) + list(tpex_daily_data.values()):
        all_codes.update(d_data.keys())
        
    for code in all_codes:
        # 1. 檢查上市
        is_twse = False
        foreign_buys = []
        trust_buys = []
        for day in twse_valid_days:
            if code in twse_daily_data[day]:
                is_twse = True
                foreign_buys.append(twse_daily_data[day][code]["foreign"])
                trust_buys.append(twse_daily_data[day][code]["trust"])
                
        # 2. 檢查上櫃
        if not is_twse:
            for day in tpex_valid_days:
                if code in tpex_daily_data[day]:
                    foreign_buys.append(tpex_daily_data[day][code]["foreign"])
                    trust_buys.append(tpex_daily_data[day][code]["trust"])
                    
        # 判斷是否連續 3 天買超
        # 買超定義為 net > 0
        is_foreign_consecutive_3 = len(foreign_buys) >= 3 and all(v > 0 for v in foreign_buys[:3])
        is_trust_consecutive_3 = len(trust_buys) >= 3 and all(v > 0 for v in trust_buys[:3])
        
        if is_foreign_consecutive_3 or is_trust_consecutive_3:
            res_map[code] = {
                "foreign_consecutive_3": is_foreign_consecutive_3,
                "trust_consecutive_3": is_trust_consecutive_3,
                "foreign_detail": foreign_buys[:3],
                "trust_detail": trust_buys[:3]
            }
            
    print(f"✅ 連續 3 天買超的標的共有 {len(res_map)} 檔。")
    return res_map

if __name__ == "__main__":
    res = get_recent_3_days_data()
    # 隨便印幾檔出來看看
    for k, v in list(res.items())[:5]:
        print(k, v)
