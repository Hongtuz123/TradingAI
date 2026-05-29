import yfinance as yf
import pandas as pd

def check_twii():
    print("Checking ^TWII from yfinance...")
    ticker = yf.Ticker("^TWII")
    hist = ticker.history(period="5d")
    print(hist)

if __name__ == "__main__":
    check_twii()
