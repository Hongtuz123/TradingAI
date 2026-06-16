import re

file_path = r"C:\GoogleAntigravity\2026Trading1\data.js"
target_symbols = ['1342', '2472', '3008', '3034', '3406', '4958', '4961', '5228', '6525']

try:
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 尋找 "id": "XXXX"
    found_symbols = re.findall(r'"id":\s*"(\d+)"', content)
    found_set = set(found_symbols)
    
    print("Total stocks in data.js:", len(found_set))
    print("Target status in data.js:")
    missing = []
    for s in target_symbols:
        status = "Exist" if s in found_set else "MISSING ❌"
        print(f"  {s}: {status}")
        if s not in found_set:
            missing.append(s)
            
    if missing:
        print("\nMissing from data.js:", missing)
    else:
        print("\nAll target stocks are present in data.js! 🎉")
        
except Exception as e:
    print("Error:", e)
