import requests

api_key = "OGI4NjdlNGQtNzU4Yy00NGEwLTk0MjYtYjZiYjY2MzFlZjdiIDZlMDE2ZDA0LWIwNTctNDg2My04ODFlLTFjNmFlMmUxNDhmNQ=="

headers = {"X-API-KEY": api_key}

url = "https://api.fugle.tw/marketdata/v1.0/stock/snapshot/quotes/TSE"
res = requests.get(url, headers=headers)
print("TSE Snapshot Code:", res.status_code)
if res.status_code == 200:
    data = res.json()
    print("Items:", len(data.get('data', [])))
    print("Example:", data.get('data', [])[:2])
