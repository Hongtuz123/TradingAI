import yfinance as yf

for sym in ["00403A.TW", "9816.TW", "009816.TW"]:
    try:
        print(f"--- 測試 {sym} ---")
        t = yf.Ticker(sym)
        df = t.history(period="250d")
        print("Data shape:", df.shape)
        if not df.empty:
            print("First 3 rows:\n", df.head(3))
            print("Last 3 rows:\n", df.tail(3))
        else:
            print("DataFrame is empty!")
    except Exception as e:
        print(f"Error for {sym}: {e}")
