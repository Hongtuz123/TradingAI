import yfinance as yf
import json

def test_fundamental(symbol):
    ticker = yf.Ticker(symbol)
    try:
        info = ticker.info
        print(f"=== {symbol} info ===")
        print("trailingEps:", info.get('trailingEps'))
        print("forwardEps:", info.get('forwardEps'))
        print("returnOnEquity:", info.get('returnOnEquity'))
        print("revenueGrowth:", info.get('revenueGrowth'))
        print("grossMargins:", info.get('grossMargins'))
        print("debtToEquity:", info.get('debtToEquity'))
        print("marketCap:", info.get('marketCap'))
    except Exception as e:
        print(f"Error for {symbol}: {e}")

if __name__ == "__main__":
    test_fundamental("2330.TW")
    test_fundamental("2360.TW")
