import requests
url = "https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&t=D&d=115/05/22&s=0,asc"
res = requests.get(url, timeout=10)
if res.status_code == 200:
    data = res.json()
    # 尋找所有欄位名稱
    if "tables" in data and len(data["tables"]) > 0:
        table = data["tables"][0]
        # 印出 table 所有的 keys
        print("Table keys:", table.keys())
        if "reportColumns" in table:
            print("reportColumns:", table["reportColumns"])
        if "headers" in table:
            print("headers:", table["headers"])
        if "fields" in table:
            print("fields:", table["fields"])
        # 如果是 nested headers
        for k in table.keys():
            if "header" in k.lower() or "column" in k.lower():
                print(f"{k}:", table[k])
