import requests
import json

def debug_stock(target_code):
    print(f"\n=== Debugging Stock {target_code} ===")
    
    # 1. 損益表與 EPS API
    url_eps = "https://openapi.twse.com.tw/v1/opendata/t187ap14_L"
    res_eps = requests.get(url_eps)
    eps_row = None
    if res_eps.status_code == 200:
        for r in res_eps.json():
            if r.get("公司代號") == target_code:
                eps_row = r
                break
                
    # 2. 資產負債表 API
    url_bs = "https://openapi.twse.com.tw/v1/opendata/t187ap07_L_ci"
    res_bs = requests.get(url_bs)
    bs_row = None
    if res_bs.status_code == 200:
        for r in res_bs.json():
            if r.get("公司代號") == target_code:
                bs_row = r
                break
                
    if eps_row:
        print("EPS Row:")
        print(json.dumps(eps_row, ensure_ascii=False, indent=2))
    else:
        print("No EPS row found in TWSE. Trying TPEx...")
        # 試試上櫃
        url_tpex_eps = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O"
        res_tpex_eps = requests.get(url_tpex_eps)
        if res_tpex_eps.status_code == 200:
            for r in res_tpex_eps.json():
                if r.get("SecuritiesCompanyCode") == target_code:
                    eps_row = r
                    print("TPEx EPS Row:")
                    print(json.dumps(eps_row, ensure_ascii=False, indent=2))
                    break
                    
    if bs_row:
        print("Balance Sheet Row:")
        print(json.dumps(bs_row, ensure_ascii=False, indent=2))
    else:
        print("No Balance Sheet row found in TWSE. Trying TPEx...")
        url_tpex_bs = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap07_O_ci"
        res_tpex_bs = requests.get(url_tpex_bs)
        if res_tpex_bs.status_code == 200:
            for r in res_tpex_bs.json():
                if r.get("SecuritiesCompanyCode") == target_code:
                    bs_row = r
                    print("TPEx Balance Sheet Row:")
                    print(json.dumps(bs_row, ensure_ascii=False, indent=2))
                    break

if __name__ == "__main__":
    for code in ["5289", "3006", "2451", "2408"]:
        debug_stock(code)
