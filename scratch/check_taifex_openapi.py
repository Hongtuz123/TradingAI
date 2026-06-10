import requests
import json

url = "https://openapi.taifex.com.tw/v1/DailyMarketReportFut"
try:
    res = requests.get(url, timeout=15)
    if res.status_code == 200:
        data = res.json()
        # 列出所有不重複的 Contract 代號前 30 個
        contracts = sorted(list(set(d.get("Contract") for d in data if d.get("Contract"))))
        print("Available Contracts (first 30):", contracts[:30])
        
        # 尋找 Contract 等於 TX 的項目
        tx_items = [d for d in data if d.get("Contract") == "TX"]
        print(f"Total TX items: {len(tx_items)}")
        
        # 按 TradingSession 分類
        for session in ["一般", "盤後"]:
            session_items = [d for d in tx_items if d.get("TradingSession") == session]
            print(f"  TradingSession = {session} count: {len(session_items)}")
            if len(session_items) > 0:
                print(f"  Sample {session} TX contract (first contract month):")
                # 通常近月的合約會排在前面，我們列印第一個看看
                print(session_items[0])
    else:
        print("Error Status:", res.status_code)
except Exception as e:
    print("Error:", e)
