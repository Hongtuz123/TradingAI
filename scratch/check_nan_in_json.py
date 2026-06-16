import os

file_path = "data.json"
if os.path.exists(file_path):
    print("File size:", os.path.getsize(file_path))
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    # 尋找無引號的 NaN
    import re
    # 搜尋含有 : NaN 的行並印出
    for i, line in enumerate(content.splitlines()):
        if "NaN" in line:
            print(f"Line {i+1}: {line.strip()}")
else:
    print("data.json not found!")
