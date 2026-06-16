import pandas as pd

try:
    df = pd.read_excel("c:/GoogleAntigravity/2026Trading1/股票分析清單.xlsx")
    print("Columns in 股票分析清單.xlsx:", df.columns.tolist())
    # Search for 6693 in any column
    for col in df.columns:
        matches = df[df[col].astype(str).str.contains("6693|廣閎科", na=False)]
        if not matches.empty:
            print(f"Found match in column '{col}':")
            print(matches)
except Exception as e:
    print("Error reading excel:", str(e))
