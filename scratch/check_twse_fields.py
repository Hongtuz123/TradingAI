import requests
res = requests.get('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', timeout=10)
if res.status_code == 200:
    data = res.json()
    for item in data[:5]:
        print(item)
