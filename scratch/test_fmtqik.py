import requests
import json

def test_fmtqik():
    print("Testing TWSE FMTQIK...")
    url = "https://www.twse.com.tw/exchangeReport/FMTQIK?response=json"
    res = requests.get(url, timeout=10)
    print("Status code:", res.status_code)
    if res.status_code == 200:
        data = res.json()
        print("Keys:", list(data.keys()))
        if 'data' in data:
            print("Total rows:", len(data['data']))
            print("Last Row:", data['data'][-1])
            # FMTQIK 的欄位通常是: [日期, 成交股數, 成交金額, 成交筆數, 發行量加權股價指數, 漲跌點數]
            if 'fields' in data:
                print("Fields:", data['fields'])

if __name__ == "__main__":
    test_fmtqik()
