import requests
import json

def check_tpex_eps():
    url = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O"
    try:
        res = requests.get(url, timeout=10)
        if res.status_code == 200:
            data = res.json()
            print("TPEx EPS Total rows:", len(data))
            if len(data) > 0:
                print("TPEx EPS Example:", json.dumps(data[0], ensure_ascii=False, indent=2))
        else:
            print("TPEx EPS Failed:", res.status_code)
    except Exception as e:
        print("TPEx EPS Error:", e)

def check_tpex_revenue():
    url = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O"
    try:
        res = requests.get(url, timeout=10)
        if res.status_code == 200:
            data = res.json()
            print("TPEx Revenue Total rows:", len(data))
            if len(data) > 0:
                print("TPEx Revenue Example:", json.dumps(data[0], ensure_ascii=False, indent=2))
        else:
            print("TPEx Revenue Failed:", res.status_code)
    except Exception as e:
        print("TPEx Revenue Error:", e)

if __name__ == "__main__":
    print("=== Testing TPEx EPS ===")
    check_tpex_eps()
    
    print("\n=== Testing TPEx Revenue ===")
    check_tpex_revenue()
