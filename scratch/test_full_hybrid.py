import requests
import json

def safe_float(val):
    if val is None or val == "":
        return None
    try:
        return float(str(val).replace(",", "").strip())
    except ValueError:
        return None

def get_stock_code(row):
    code = row.get("公司代號") or row.get("SecuritiesCompanyCode") or row.get("Code")
    if code:
        return str(code).strip()
    return None

def fetch_openapi_fundamentals():
    print("⏳ 開始下載台灣官方 OpenAPI 批量基本面數據...")
    fundamentals = {}

    # 1. 抓取上市櫃月營收 YoY
    print("  正在抓取月營收 YoY...")
    try:
        res = requests.get("https://openapi.twse.com.tw/v1/opendata/t187ap05_L", timeout=10)
        if res.status_code == 200:
            for r in res.json():
                code = get_stock_code(r)
                if code:
                    val = safe_float(r.get("營業收入-去年同月增減(%)"))
                    if val is not None:
                        fundamentals.setdefault(code, {})["revYoY"] = round(val, 2)
    except Exception as e:
        print(f"  ⚠️ 上市月營收抓取失敗: {e}")

    try:
        res = requests.get("https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O", timeout=10)
        if res.status_code == 200:
            for r in res.json():
                code = get_stock_code(r)
                if code:
                    val = safe_float(r.get("營業收入-去年同月增減(%)"))
                    if val is not None:
                        fundamentals.setdefault(code, {})["revYoY"] = round(val, 2)
    except Exception as e:
        print(f"  ⚠️ 上櫃月營收抓取失敗: {e}")

    # 2. 抓取上市櫃毛利率
    print("  正在抓取毛利率...")
    try:
        res = requests.get("https://openapi.twse.com.tw/v1/opendata/t187ap17_L", timeout=10)
        if res.status_code == 200:
            for r in res.json():
                code = get_stock_code(r)
                if code:
                    val = safe_float(r.get("毛利率(%)(營業毛利)/(營業收入)"))
                    if val is not None:
                        fundamentals.setdefault(code, {})["grossMargin"] = round(val, 2)
    except Exception as e:
        print(f"  ⚠️ 上市毛利率抓取失敗: {e}")

    try:
        res = requests.get("https://www.tpex.org.tw/openapi/v1/mopsfin_187ap17_O", timeout=10)
        if res.status_code == 200:
            for r in res.json():
                code = get_stock_code(r)
                if code:
                    val = safe_float(r.get("毛利率"))
                    if val is not None:
                        fundamentals.setdefault(code, {})["grossMargin"] = round(val, 2)
    except Exception as e:
        print(f"  ⚠️ 上櫃毛利率抓取失敗: {e}")

    # 3. 抓取上市櫃資產負債表並計算負債比與留存權益總額
    print("  正在抓取資產負債表...")
    equity_data = {}
    try:
        res = requests.get("https://openapi.twse.com.tw/v1/opendata/t187ap07_L_ci", timeout=10)
        if res.status_code == 200:
            for r in res.json():
                code = get_stock_code(r)
                if code:
                    debt = safe_float(r.get("負債總額"))
                    assets = safe_float(r.get("資產總額"))
                    equity = safe_float(r.get("權益總額"))
                    if debt is not None and assets is not None and assets > 0:
                        fundamentals.setdefault(code, {})["debtRatio"] = round((debt / assets) * 100, 2)
                    if equity is not None:
                        equity_data[code] = equity
    except Exception as e:
        print(f"  ⚠️ 上市資產負債表抓取失敗: {e}")

    try:
        res = requests.get("https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap07_O_ci", timeout=10)
        if res.status_code == 200:
            for r in res.json():
                code = get_stock_code(r)
                if code:
                    debt = safe_float(r.get("負債總額"))
                    assets = safe_float(r.get("資產總額"))
                    equity = safe_float(r.get("權益總額"))
                    if debt is not None and assets is not None and assets > 0:
                        fundamentals.setdefault(code, {})["debtRatio"] = round((debt / assets) * 100, 2)
                    if equity is not None:
                        equity_data[code] = equity
    except Exception as e:
        print(f"  ⚠️ 上櫃資產負債表抓取失敗: {e}")

    # 4. 抓取上市櫃當季 EPS 與稅後淨利
    print("  正在抓取當季 EPS 與稅後淨利...")
    eps_data = {}
    try:
        res = requests.get("https://openapi.twse.com.tw/v1/opendata/t187ap14_L", timeout=10)
        if res.status_code == 200:
            for r in res.json():
                code = get_stock_code(r)
                if code:
                    eps_val = safe_float(r.get("基本每股盈餘(元)"))
                    net_inc = safe_float(r.get("稅後淨利"))
                    eps_data[code] = {"eps": eps_val, "netIncome": net_inc}
    except Exception as e:
        print(f"  ⚠️ 上市 EPS 抓取失敗: {e}")

    try:
        res = requests.get("https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O", timeout=10)
        if res.status_code == 200:
            for r in res.json():
                code = get_stock_code(r)
                if code:
                    eps_val = safe_float(r.get("基本每股盈餘"))
                    net_inc = safe_float(r.get("稅後淨利"))
                    eps_data[code] = {"eps": eps_val, "netIncome": net_inc}
    except Exception as e:
        print(f"  ⚠️ 上櫃 EPS 抓取失敗: {e}")

    # 5. 合併計算 ROE 與 EPS
    print("  正在進行 ROE 計算與最後基本面數據彙整...")
    all_codes = set(list(fundamentals.keys()) + list(eps_data.keys()))
    for code in all_codes:
        fundamentals.setdefault(code, {})
        
        # EPS 填入
        eps_info = eps_data.get(code, {})
        fundamentals[code]["eps"] = eps_info.get("eps")
        
        # ROE 計算 = (稅後淨利 / 權益總額) * 4 * 100
        net_inc = eps_info.get("netIncome")
        equity = equity_data.get(code)
        if net_inc is not None and equity is not None and equity > 0:
            fundamentals[code]["roe"] = round((net_inc / equity) * 4 * 100, 2)
        else:
            fundamentals[code]["roe"] = None

    print(f"🎉 OpenAPI 基本面數據下載完成！共彙整 {len(fundamentals)} 檔股票。")
    return fundamentals

if __name__ == "__main__":
    fund = fetch_openapi_fundamentals()
    
    # 測試幾檔知名標的
    for test_code in ["1101", "2330", "2360", "1240"]:
        print(f"\nStock {test_code} fundamentals:")
        print(json.dumps(fund.get(test_code), ensure_ascii=False, indent=2))
