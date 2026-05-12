import requests
import json

FUGLE_API_KEY = "OGI4NjdlNGQtNzU4Yy00NGEwLTk0MjYtYjZiYjY2MzFlZjdiIDZlMDE2ZDA0LWIwNTctNDg2My04ODFlLTFjNmFlMmUxNDhmNQ=="

def test_api(symbol):
    url = f"https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/{symbol}?fields=open,high,low,close,volume"
    headers = {"X-API-KEY": FUGLE_API_KEY}
    res = requests.get(url, headers=headers)
    print(f"Status: {res.status_code}")
    if res.status_code == 200:
        data = res.json().get('data', [])
        if data:
            print(f"Latest candle for {symbol}: {data[-1]}")
        else:
            print("No data found")
    else:
        print(f"Error: {res.text}")

test_api("2330")
test_api("3030")
