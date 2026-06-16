import re
import json

print("Loading data.js...")
with open("c:/GoogleAntigravity/2026Trading1/data.js", "r", encoding="utf-8") as f:
    content = f.read()

# Let's extract blocks
# We'll search for const marketData = ...
# const rulesConfig = ...
# const mockStocks = ...

def extract_js_object(var_name, text):
    pattern = rf"const\s+{var_name}\s*=\s*([\s\S]*?)(?=const\s+\w+\s*=|^\s*$|\Z)"
    match = re.search(pattern, text)
    if not match:
        return None
    val_str = match.group(1).strip()
    # Remove trailing semicolon
    if val_str.endswith(";"):
        val_str = val_str[:-1]
    # Remove single line comments
    val_str = re.sub(r"//.*$", "", val_str, flags=re.MULTILINE)
    return val_str

print("Extracting marketData...")
market_data_str = extract_js_object("marketData", content)
print("Extracting rulesConfig...")
rules_config_str = extract_js_object("rulesConfig", content)
print("Extracting mockStocks...")
mock_stocks_str = extract_js_object("mockStocks", content)

def parse_and_search(name, json_str):
    if not json_str:
        print(f"Variable {name} not found.")
        return
    
    # Try to clean trailing commas which are valid in JS but invalid in JSON
    # This regex is a simple heuristic: remove comma before closing brace/bracket
    json_str_cleaned = re.sub(r",\s*([\}\]])", r"\1", json_str)
    
    try:
        data = json.loads(json_str_cleaned)
        print(f"Successfully parsed {name} as JSON! Type: {type(data)}")
        
        # Search for "6693"
        def search_target(d, target="6693"):
            if isinstance(d, dict):
                for k, v in d.items():
                    if k == target:
                        return v
                    res = search_target(v, target)
                    if res is not None:
                        return res
            elif isinstance(d, list):
                for item in d:
                    if isinstance(item, dict) and (str(item.get("id")) == target or str(item.get("symbol")) == target or str(item.get("code")) == target):
                        return item
                    res = search_target(item, target)
                    if res is not None:
                        return res
            return None
        
        res = search_target(data)
        if res:
            print(f"=== Found 6693 in {name} ===")
            if isinstance(res, dict):
                for k, v in res.items():
                    if k not in ["kline", "history"]:
                        print(f"  {k}: {v}")
                    else:
                        print(f"  {k} length: {len(v)} records")
                        if len(v) > 0:
                            print(f"    Last: {v[-1]}")
                            if len(v) > 1:
                                print(f"    Second to last: {v[-2]}")
            else:
                print(res)
            return True
    except Exception as e:
        print(f"Failed to parse {name}: {str(e)}")
        # If it failed to parse, let's just search the raw string for "6693"
        lines = json_str.split("\n")
        print(f"Doing fallback string search in {name}...")
        found = False
        for i, line in enumerate(lines):
            if "6693" in line or "廣閎科" in line:
                print(f"  Line {i+1}: {line.strip()}")
                found = True
        return found

found_any = False
if parse_and_search("marketData", market_data_str):
    found_any = True
if parse_and_search("rulesConfig", rules_config_str):
    found_any = True
if parse_and_search("mockStocks", mock_stocks_str):
    found_any = True

if not found_any:
    print("Could not find any match for 6693 in parsed structures.")
