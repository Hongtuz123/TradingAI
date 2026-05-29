import requests
import json

def test_tpex_summary():
    print("Testing TPEx Summary Result...")
    url = "https://www.tpex.org.tw/web/stock/aftertrading/index_summary/summary_result.php?l=zh-tw&o=json"
    res = requests.get(url, timeout=10)
    print("Status:", res.status_code)
    if res.status_code == 200:
        try:
            data = res.json()
            print("Keys:", list(data.keys()))
            if 'tables' in data:
                print("Total tables:", len(data['tables']))
                for idx, t in enumerate(data['tables']):
                    print(f"Table {idx}: title={t.get('title')}")
                    if 'data' in t and len(t['data']) > 0:
                        print("  Data len:", len(t['data']))
                        print("  Sample row 0:", t['data'][0])
                        print("  Sample row last:", t['data'][-1])
        except Exception as e:
            print("Failed to parse JSON:", e)

if __name__ == "__main__":
    test_tpex_summary()
