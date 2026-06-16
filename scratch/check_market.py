import json
import re

file_path = r"C:\GoogleAntigravity\2026Trading1\data.js"
target_symbols = ['1342', '2472', '3008', '3034', '3406', '4958', '4961', '5228', '6525']

try:
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 既然 data.js 的 mockStocks 是一個大 array，我們可以用 regex 找出每個 id 的 market
    # 比如尋找 {"id":"1342","name":"八貫","market":"TSE" ... }
    # 我們可以搜尋 "id": "1342", "name": "...", "market": "..." 
    for s in target_symbols:
        pattern = rf'"id":\s*"{s}",\s*"name":\s*"([^"]+)",\s*"market":\s*"([^"]+)"'
        match = re.search(pattern, content)
        if match:
            name, market = match.groups()
            print(f"{{'Code': '{s}', 'Name': '{name}', 'market': '{market}'}},")
        else:
            # 有可能是單引號或空格稍微不同，我們試試更寬鬆的 pattern
            pattern_lax = rf'"id":\s*"{s}"'
            match_lax = re.search(pattern_lax, content)
            if match_lax:
                # 往後找 market
                start_idx = match_lax.start()
                sub_str = content[start_idx:start_idx+300]
                market_match = re.search(r'"market":\s*"([^"]+)"', sub_str)
                name_match = re.search(r'"name":\s*"([^"]+)"', sub_str)
                name = name_match.group(1) if name_match else ""
                market = market_match.group(1) if market_match else "TSE"
                print(f"{{'Code': '{s}', 'Name': '{name}', 'market': '{market}'}},")
            else:
                print(f"# {s} not found in search")
except Exception as e:
    print("Error:", e)
