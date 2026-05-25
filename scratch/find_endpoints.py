import requests
import json

def find_endpoints(swagger_url, keywords):
    try:
        res = requests.get(swagger_url, timeout=15)
        if res.status_code == 200:
            swagger = res.json()
            paths = swagger.get("paths", {})
            print(f"Total paths in {swagger_url}: {len(paths)}")
            
            matched = []
            for path, methods in paths.items():
                # 檢查 path 裡面有沒有關鍵字，或者 description/summary 裡有沒有
                path_lower = path.lower()
                summary = ""
                description = ""
                for method, info in methods.items():
                    summary = info.get("summary", "")
                    description = info.get("description", "")
                    break
                
                text_to_check = f"{path_lower} {summary} {description}".lower()
                for kw in keywords:
                    if kw.lower() in text_to_check:
                        matched.append((path, summary))
                        break
            
            print(f"Matched {len(matched)} endpoints:")
            for m in matched[:50]:
                print(f"  {m[0]} -> {m[1]}")
        else:
            print("Failed to fetch swagger, status:", res.status_code)
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    keywords = ["eps", "roe", "營收", "財務", "損益", "負債", "毛利", "revenue", "financial", "ratio", "mops"]
    print("--- Searching TWSE OpenAPI ---")
    find_endpoints("https://openapi.twse.com.tw/v1/swagger.json", keywords)
    
    print("\n--- Searching TPEx OpenAPI ---")
    find_endpoints("https://www.tpex.org.tw/openapi/swagger.json", keywords)
