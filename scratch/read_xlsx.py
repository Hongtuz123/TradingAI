import openpyxl

file_path = r"C:\GoogleAntigravity\2026Trading1\scratch\L2_Backtest_Result.xlsx"
try:
    wb = openpyxl.load_workbook(file_path, data_only=True)
    sheet = wb.active
    print(f"Active Sheet: {sheet.title}")
    
    rows = list(sheet.iter_rows(values_only=True))
    if not rows:
        print("Empty sheet.")
        exit(0)
        
    headers = rows[0]
    print("Headers:", headers)
    
    # 明確指定欄位
    symbol_idx = 0  # 股票代號
    name_idx = 1    # 股票簡稱
    score_idx = 2   # L2 總得分
    
    high_scores = []
    for row in rows[1:]:
        sym = row[symbol_idx]
        name = row[name_idx]
        score = row[score_idx]
        if sym is not None and score is not None:
            try:
                score_val = float(score)
                if score_val >= 80:
                    high_scores.append((str(sym), str(name), score_val))
            except ValueError:
                pass
    print(f"Found {len(high_scores)} stocks with score >= 80:")
    for sym, name, score in high_scores:
        print(f"Symbol: {sym}, Name: {name}, Score: {score}")
        
except Exception as e:
    print("Error:", e)
