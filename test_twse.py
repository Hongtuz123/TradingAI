import requests
import json

url = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"
res = requests.get(url)
print(res.status_code)
if res.status_code == 200:
    data = res.json()
    print("Total stocks:", len(data))
    print("Example:", data[0])
