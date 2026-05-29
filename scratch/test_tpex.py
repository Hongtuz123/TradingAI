import requests
import json

def test_tpex():
    print("Testing TPEx market statistics...")
    # statistics.php 是櫃買市場每日成交統計，包含櫃買指數
    url = "https://www.tpex.org.tw/web/stock/aftertrading/market_statistics/statistics.php?l=zh-tw&o=json"
    res = requests.get(url, timeout=10)
    print("Status code:", res.status_code)
    if res.status_code == 200:
        data = res.json()
        print("Keys:", list(data.keys()))
        if 'iTotalRecords' in data:
            print("Total records:", data['iTotalRecords'])
        if 'aaData' in data and len(data['aaData']) > 0:
            print("Last Row:", data['aaData'][-1])
            # 欄位說明
            # 通常 aaData 的一列資料包含: [日期, 成交股數, 成交金額, 成交筆數, 櫃買指數, 漲跌]

if __name__ == "__main__":
    test_tpex()
