import json
import re

print("Loading data.js...")
with open("c:/GoogleAntigravity/2026Trading1/data.js", "r", encoding="utf-8") as f:
    content = f.read()

# We know mockStocks is a JS array: const mockStocks = [...]
# Let's extract everything inside const mockStocks = [ ... ];
# Since mockStocks is at the end of the file, we can find its start index.
match = re.search(r"const\s+mockStocks\s*=\s*", content)
if not match:
    print("Could not find mockStocks declaration.")
    exit()

start_idx = match.end()
# Remove trailing semicolon
mock_stocks_str = content[start_idx:].strip()
if mock_stocks_str.endswith(";"):
    mock_stocks_str = mock_stocks_str[:-1]

# Clean comments and trailing commas
mock_stocks_str = re.sub(r"//.*$", "", mock_stocks_str, flags=re.MULTILINE)
mock_stocks_str = re.sub(r",\s*([\}\]])", r"\1", mock_stocks_str)

print("Parsing mockStocks array...")
try:
    stocks = json.loads(mock_stocks_str)
    print(f"Parsed {len(stocks)} stocks.")
    
    matches = [s for s in stocks if str(s.get("id")) == "6693"]
    print(f"Found {len(matches)} occurrences of 6693 in mockStocks:")
    
    for idx, s in enumerate(matches):
        print(f"\n--- Match {idx+1} ---")
        # Print without kline to keep it short
        summary = {k: v for k, v in s.items() if k != "kline"}
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        if "kline" in s:
            print(f"  Kline length: {len(s['kline'])} days")
            if len(s['kline']) > 0:
                print(f"  First day: {s['kline'][0]}")
                print(f"  Last day: {s['kline'][-1]}")
except Exception as e:
    print("Failed to parse mockStocks:", str(e))
