import requests
import json

url = "https://www.twse.com.tw/rwd/zh/fund/T86?date=20260522&selectType=ALLBUT0999&response=json"
try:
    res = requests.get(url, timeout=10)
    if res.status_code == 200:
        data = res.json()
        if "fields" in data:
            for idx, field in enumerate(data["fields"]):
                print(f"Index {idx}: {field}")
        else:
            print("No fields found. Stat:", data.get("stat"))
    else:
        print("Status code:", res.status_code)
except Exception as e:
    print("Error:", e)
