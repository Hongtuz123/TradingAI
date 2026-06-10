import yfinance as yf
import json

symbols = ["WTXP&", "^WTXP", "WTX", "WTX&", "WTXP&=F", "WTX=F"]
for sym in symbols:
    print(f"--- Checking {sym} ---")
    try:
        ticker = yf.Ticker(sym)
        hist = ticker.history(period="5d")
        if not hist.empty:
            print(f"SUCCESS: {sym} found!")
            print(hist.tail(2))
        else:
            print(f"EMPTY: {sym} returned empty history.")
    except Exception as e:
        print(f"ERROR: {sym} failed: {e}")
