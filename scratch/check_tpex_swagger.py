import requests
import json

def check_swagger():
    url = "https://www.tpex.org.tw/openapi/swagger.json"
    res = requests.get(url)
    if res.status_code == 200:
        data = res.json()
        print("Swagger Keys:", data.keys())
        print("basePath:", data.get("basePath"))
        print("servers:", data.get("servers"))
        print("host:", data.get("host"))
        print("schemes:", data.get("schemes"))
        
        # 看看 /mopsfin_t187ap05_O 的定義
        paths = data.get("paths", {})
        if "/mopsfin_t187ap05_O" in paths:
            print("/mopsfin_t187ap05_O:", json.dumps(paths["/mopsfin_t187ap05_O"], ensure_ascii=False, indent=2))
            
        # 看看有沒有 EPS 統計資訊
        for p in paths.keys():
            if "eps" in p.lower() or "t187ap14" in p.lower():
                print("Found path:", p)

if __name__ == "__main__":
    check_swagger()
