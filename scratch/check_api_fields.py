import requests
import json

def check_twse_eps():
    url = "https://openapi.twse.com.tw/v1/opendata/t187ap14_L"
    try:
        res = requests.get(url, timeout=10)
        if res.status_code == 200:
            data = res.json()
            print("TWSE EPS Total rows:", len(data))
            if len(data) > 0:
                print("TWSE EPS Example:", json.dumps(data[0], ensure_ascii=False, indent=2))
        else:
            print("TWSE EPS Failed:", res.status_code)
    except Exception as e:
        print("TWSE EPS Error:", e)

def check_twse_revenue():
    # 上市公司每月營業收入彙總表
    url = "https://openapi.twse.com.tw/v1/opendata/t187ap05_L"
    try:
        res = requests.get(url, timeout=10)
        if res.status_code == 200:
            data = res.json()
            print("TWSE Revenue Total rows:", len(data))
            if len(data) > 0:
                print("TWSE Revenue Example:", json.dumps(data[0], ensure_ascii=False, indent=2))
        else:
            # 試試公發公司每月營業收入彙總表-一般業
            url2 = "https://openapi.twse.com.tw/v1/opendata/t187ap05_X_ci"
            res2 = requests.get(url2, timeout=10)
            print("TWSE Revenue (t187ap05_X_ci) status:", res2.status_code)
            if res2.status_code == 200:
                data2 = res2.json()
                print("TWSE Revenue (t187ap05_X_ci) Total rows:", len(data2))
                if len(data2) > 0:
                    print("TWSE Revenue (t187ap05_X_ci) Example:", json.dumps(data2[0], ensure_ascii=False, indent=2))
    except Exception as e:
        print("TWSE Revenue Error:", e)

def check_tpex_revenue():
    url = "https://www.tpex.org.tw/openapi/mopsfin_t187ap05_O"
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
    print("=== Testing TWSE EPS ===")
    check_twse_eps()
    
    print("\n=== Testing TWSE Revenue ===")
    check_twse_revenue()
    
    print("\n=== Testing TPEx Revenue ===")
    check_tpex_revenue()
