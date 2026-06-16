import yfinance as yf
import pandas as pd

print("Fetching 6693.TWO history...")
try:
    t1 = yf.Ticker("6693.TWO")
    hist1 = t1.history(period="5d")
    print("\n--- 6693.TWO History ---")
    print(hist1)
except Exception as e:
    print("Error fetching 6693.TWO:", str(e))

print("\nFetching 6693.TW history...")
try:
    t2 = yf.Ticker("6693.TW")
    hist2 = t2.history(period="5d")
    print("\n--- 6693.TW History ---")
    print(hist2)
except Exception as e:
    print("Error fetching 6693.TW:", str(e))
