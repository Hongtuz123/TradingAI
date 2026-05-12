import requests
import json

def test_openapi():
    # TWSE
    res = requests.get('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', timeout=10)
    if res.status_code == 200:
        data = res.json()
        if data:
            print(f"TWSE keys: {data[0].keys()}")
            # Find 2330
            tsmc = next((x for x in data if x['Code'] == '2330'), None)
            print(f"TSMC: {tsmc}")
    
    # OTC
    res = requests.get('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes', timeout=10)
    if res.status_code == 200:
        data = res.json()
        if data:
            print(f"OTC keys: {data[0].keys()}")
            # Find 6788
            hj = next((x for x in data if x.get('SecuritiesCompanyCode') == '6788' or x.get('Code') == '6788'), None)
            print(f"HJ: {hj}")

test_openapi()
