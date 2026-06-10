import requests
import json

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.wantgoo.com/"
}

# 玩股網台指期盤後代號通常是 WTXP&
url = "https://www.wantgoo.com/global/api/chart?stockNo=WTXP%26&timeCode=1"
print(f"Requesting WantGoo url: {url}")
try:
    res = requests.get(url, headers=headers, timeout=10)
    print(f"Status: {res.status_code}")
    if res.status_code == 200:
        data = res.json()
        print("Success! Data preview (last 3 items):")
        # 玩股網回傳格式通常是 { "candles": [...] } 或是陣列
        if isinstance(data, list):
            print(data[-3:])
        elif isinstance(data, dict):
            # 印出 keys
            print("Keys:", data.keys())
            for k in list(data.keys())[:3]:
                val = data[k]
                if isinstance(val, list):
                    print(f"Key {k} (len={len(val)}):", val[-3:])
                else:
                    print(f"Key {k}:", str(val)[:100])
        else:
            print(str(data)[:500])
    else:
        print("Response Text:", res.text[:200])
except Exception as e:
    print(f"Error: {e}")
