import requests
import json

def save_all_endpoints(url, filename):
    try:
        res = requests.get(url, timeout=15)
        if res.status_code == 200:
            swagger = res.json()
            paths = swagger.get("paths", {})
            
            lines = []
            for path, methods in sorted(paths.items()):
                summary = ""
                description = ""
                for method, info in methods.items():
                    summary = info.get("summary", "")
                    description = info.get("description", "")
                    break
                lines.append(f"{path} | {summary} | {description}")
                
            with open(filename, "w", encoding="utf-8") as f:
                f.write("\n".join(lines))
            print(f"Saved {len(lines)} endpoints to {filename}")
        else:
            print(f"Failed to fetch swagger from {url}")
    except Exception as e:
        print(f"Error {url}: {e}")

if __name__ == "__main__":
    save_all_endpoints("https://openapi.twse.com.tw/v1/swagger.json", "scratch/twse_endpoints.txt")
    save_all_endpoints("https://www.tpex.org.tw/openapi/swagger.json", "scratch/tpex_endpoints.txt")
