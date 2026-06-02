import os
import re

BASE_DIR = r"c:\GoogleAntigravity\2026Trading1"
CSV_PATH = os.path.join(BASE_DIR, "個股產業分類對照表.csv")
APP_JS_PATH = os.path.join(BASE_DIR, "app.js")

def main():
    if not os.path.exists(CSV_PATH):
        print(f"找不到對照表 CSV: {CSV_PATH}")
        return

    # 1. 讀取 CSV 建立對照字典
    import csv
    compensation_dict = {}
    with open(CSV_PATH, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            code = row["股票代碼"].strip()
            industry = row["產業"].strip()
            category = row["分類"].strip()
            if code:
                # 格式: '大分類:細分族群'
                compensation_dict[code] = f"{industry}:{category}"

    print(f"從 CSV 載入了 {len(compensation_dict)} 檔個股分類對照數據！")

    # 2. 生成 JavaScript Object 字串
    js_lines = [
        "// 核心股票之「產業 > 族群」三層高精細分類補償表 (參照 CMoney 股市爆料同學會 category 產業分類大綱與細分標準)",
        "const SECTOR_COMPENSATION = {"
    ]
    
    # 排序使代碼整齊
    sorted_codes = sorted(compensation_dict.keys())
    for i, code in enumerate(sorted_codes):
        val = compensation_dict[code]
        comma = "," if i < len(sorted_codes) - 1 else ""
        js_lines.append(f"  '{code}': '{val}'{comma}")
        
    js_lines.append("};")
    js_object_str = "\n".join(js_lines)

    # 3. 讀取 app.js 並進行替換
    with open(APP_JS_PATH, "r", encoding="utf-8") as f:
        app_content = f.read()

    # 使用正則表達式尋找 const SECTOR_COMPENSATION = { ... };
    # 匹配 const SECTOR_COMPENSATION = { 任何字元直到 };
    pattern = r"// 核心股票之「產業 > 族群」[^\n]*\nconst SECTOR_COMPENSATION = \{[\s\S]*?\};"
    
    # 檢查是否能匹配
    if not re.search(pattern, app_content):
        # 嘗試更寬鬆的匹配
        pattern = r"const SECTOR_COMPENSATION = \{[\s\S]*?\};"

    if re.search(pattern, app_content):
        new_app_content = re.sub(pattern, js_object_str, app_content)
        with open(APP_JS_PATH, "w", encoding="utf-8") as f:
            f.write(new_app_content)
        print("成功將完整的個股產業分類對照庫更新至 app.js！")
    else:
        print("錯誤: 無法在 app.js 中找到 SECTOR_COMPENSATION 定義區塊")

if __name__ == "__main__":
    main()
