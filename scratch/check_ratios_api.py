import requests
import json

def check_ratio_api(url, name):
    try:
        res = requests.get(url, timeout=10)
        if res.status_code == 200:
            data = res.json()
            print(f"=== {name} Total rows: {len(data)} ===")
            if len(data) > 0:
                print(json.dumps(data[0], ensure_ascii=False, indent=2))
        else:
            print(f"=== {name} Failed: {res.status_code} ===")
    except Exception as e:
        print(f"=== {name} Error: {e} ===")

if __name__ == "__main__":
    check_ratio_api("https://openapi.twse.com.tw/v1/opendata/t187ap17_L", "TWSE 營益分析")
    check_ratio_api("https://www.tpex.org.tw/openapi/v1/mopsfin_187ap17_O", "TPEx 營益分析")
    check_ratio_api("https://openapi.twse.com.tw/v1/opendata/t187ap07_L_ci", "TWSE 資產負債表")
