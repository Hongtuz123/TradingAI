import requests
import json
import os

def get_wtx_night_data():
    url = "https://openapi.taifex.com.tw/v1/DailyMarketReportFut"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    try:
        res = requests.get(url, headers=headers, timeout=15)
        if res.status_code != 200:
            print(f"Error fetching TAIFEX: {res.status_code}")
            return None
        
        data = res.json()
        # 篩選台指期 (TX) 且 盤後 (夜盤)
        tx_night = [d for d in data if d.get("Contract") == "TX" and d.get("TradingSession") == "盤後"]
        if not tx_night:
            print("No TX night contracts found.")
            return None
        
        # 排序取近月
        tx_night.sort(key=lambda x: x.get("ContractMonth(Week)", "999999"))
        target = tx_night[0]
        
        date_str = target.get("Date") # 格式 YYYYMMDD
        if len(date_str) == 8:
            formatted_date = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"
        else:
            formatted_date = date_str
            
        close_val = float(target.get("Last", "0").replace(",", ""))
        pct_str = target.get("%", "0%").replace("%", "").replace(",", "")
        pct_chg = float(pct_str)
        vol_val = int(target.get("Volume", "0").replace(",", ""))
        
        print(f"Fetched today WTX night: Date={formatted_date}, Close={close_val}, PctChg={pct_chg}%, Vol={vol_val}")
        
        # 維護本地歷史 JSON
        history_path = "scratch/wtx_history.json"
        history = []
        if os.path.exists(history_path):
            try:
                with open(history_path, "r", encoding="utf-8") as f:
                    history = json.load(f)
            except Exception as je:
                print(f"Read history error: {je}")
                
        # 檢查是否已存在該日期的資料，不存在則新增
        existing = [h for h in history if h.get("date") == formatted_date]
        if not existing:
            history.append({
                "date": formatted_date,
                "close": close_val,
                "volume": vol_val,
                "pct_chg": pct_chg
            })
            # 依日期排序
            history.sort(key=lambda x: x.get("date", ""))
            # 最多保留 60 筆
            history = history[-60:]
            try:
                os.makedirs(os.path.dirname(history_path), exist_ok=True)
                with open(history_path, "w", encoding="utf-8") as f:
                    json.dump(history, f, ensure_ascii=False, indent=2)
                print("Updated scratch/wtx_history.json successfully.")
            except Exception as we:
                print(f"Write history error: {we}")
        else:
            # 如果已存在，更新當天資料
            for h in history:
                if h["date"] == formatted_date:
                    h["close"] = close_val
                    h["volume"] = vol_val
                    h["pct_chg"] = pct_chg
            with open(history_path, "w", encoding="utf-8") as f:
                json.dump(history, f, ensure_ascii=False, indent=2)
            print("Updated existing date in history.")
            
        # 計算 20MA 均量
        # 過濾 volume > 0 
        valid_history = [h for h in history if h.get("volume", 0) > 0]
        if len(valid_history) >= 20:
            last_20 = valid_history[-20:]
            vol_ma20 = sum(h["volume"] for h in last_20) / 20.0
            print(f"Calculated 20MA volume from history: {vol_ma20:.2f}")
        else:
            vol_ma20 = 50000.0
            print(f"History too short (len={len(valid_history)}). Using default 20MA volume: {vol_ma20}")
            
        # 決定量能級別 vol_level
        ratio = vol_val / vol_ma20
        if ratio < 0.85:
            vol_level = "少"
        elif ratio > 1.15:
            vol_level = "多"
        else:
            vol_level = "普通"
            
        wtx_data = {
            "label": "台指夜盤",
            "pct_chg": pct_chg,
            "close": close_val,
            "volume": vol_val,
            "vol_level": vol_level,
            "above_20ma": close_val > sum(h["close"] for h in history[-20:]) / len(history[-20:]) if history else True,
            "above_60ma": close_val > sum(h["close"] for h in history[-60:]) / len(history[-60:]) if history else True,
        }
        return wtx_data
        
    except Exception as e:
        print(f"Error: {e}")
        return None

wtx = get_wtx_night_data()
print("Result WTX data structure:")
print(wtx)
