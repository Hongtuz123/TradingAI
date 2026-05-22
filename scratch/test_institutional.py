import requests
import json

def test_tpex_tables():
    print("Testing TPEx tables...")
    date = "115/05/22"
    url = f"https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&t=D&d={date}&s=0,asc"
    
    try:
        res = requests.get(url, timeout=10)
        if res.status_code == 200:
            data = res.json()
            for t_idx, table in enumerate(data['tables']):
                print(f"Table {t_idx}: title={table.get('title')}, keys={list(table.keys())}")
                if 'fields' in table:
                    print(f"  Fields count: {len(table['fields'])}")
                if 'data' in table and len(table['data']) > 0:
                    print(f"  Data len: {len(table['data'])}")
                    print(f"  Sample Row 0: {table['data'][0]}")
        else:
            print(f"Status: {res.status_code}")
    except Exception as e:
        print(f"Error: {e}")
            
if __name__ == "__main__":
    test_tpex_tables()
