import json
import re
import os

file_path = r"C:\GoogleAntigravity\2026Trading1\data.js"
print("File size:", os.path.getsize(file_path), "bytes")

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 用 regex 擷取 JSON
# const marketData = {...};
# const rulesConfig = {...};
# const mockStocks = [...];

market_data_match = re.search(r'const marketData\s*=\s*(\{.*?\});', content, re.DOTALL)
rules_config_match = re.search(r'const rulesConfig\s*=\s*(\{.*?\});', content, re.DOTALL)
mock_stocks_match = re.search(r'const mockStocks\s*=\s*(\[.*?\]);', content, re.DOTALL)

if market_data_match:
    print("marketData string size:", len(market_data_match.group(1)))
if rules_config_match:
    print("rulesConfig string size:", len(rules_config_match.group(1)))
if mock_stocks_match:
    stocks_str = mock_stocks_match.group(1)
    print("mockStocks string size:", len(stocks_str))
    try:
        stocks = json.loads(stocks_str)
        print("Total stocks count:", len(stocks))
        if len(stocks) > 0:
            sample = stocks[0]
            print("Stock keys:", sample.keys())
            if 'kline' in sample:
                print("First stock klines count:", len(sample['kline']))
                klines_size = len(json.dumps(sample['kline']))
                print("First stock klines raw size in JSON:", klines_size, "bytes")
                total_klines_size = sum(len(json.dumps(s.get('kline', []))) for s in stocks)
                print("Total klines size in JSON:", total_klines_size, "bytes")
    except Exception as e:
        print("JSON parse error:", e)
