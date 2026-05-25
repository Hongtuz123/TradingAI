import requests
import json

# 用一個有效的日期做測試，例如 115/05/22
url = "https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&t=D&d=115/05/22&s=0,asc"
try:
    res = requests.get(url, timeout=10)
    if res.status_code == 200:
        data = res.json()
        if "reportTitle" in data:
            print("Title:", data["reportTitle"])
        if "reportColumns" in data:
            for idx, col in enumerate(data["reportColumns"]):
                print(f"Index {idx}: {col}")
        elif "tables" in data and len(data["tables"]) > 0:
            table = data["tables"][0]
            if "reportColumns" in table:
                for idx, col in enumerate(table["reportColumns"]):
                    print(f"Index {idx}: {col}")
            if "data" in table and len(table["data"]) > 0:
                print("Data row length:", len(table["data"][0]))
                print("First row:", table["data"][0])
        else:
            print("Structure mismatch. Keys:", data.keys())
    else:
        print("Status code:", res.status_code)
except Exception as e:
    print("Error:", e)
