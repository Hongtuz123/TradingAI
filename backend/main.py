from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx
from datetime import datetime, timedelta
from pydantic import BaseModel

app = FastAPI(title="DouDou AI Stock Backend")

# 允許前端跨域請求 (CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 測試階段允許所有來源，上線時需限縮
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Fugle API 已停用，改用 yfinance


class KlineResponse(BaseModel):
    symbol: str
    kline: list

@app.get("/")
def read_root():
    return {"message": "DouDou AI Trading API is running."}

import yfinance as yf

@app.get("/api/history", response_model=KlineResponse)
async def get_kline_history(symbol: str, days: int = 250, interval: str = "1d", market: str = "TSE"):
    """
    抓取指定標的 (透過 yfinance)
    market: TSE=上市(.TW), OTC=上櫃(.TWO)
    """
    # 判斷是否為台股：全數字 → 上市用 .TW，OTC 用 .TWO
    yf_symbol = symbol
    if symbol.isdigit():
        suffix = '.TWO' if market.upper() == 'OTC' else '.TW'
        yf_symbol = f"{symbol}{suffix}"
    
    # 針對 intraday 資料，yfinance 有天數限制
    if interval in ["1m", "2m", "5m", "15m", "30m", "90m"]:
        days = min(days, 59)
    elif interval in ["60m", "1h"]:
        days = min(days, 729)
        
    try:
        stock = yf.Ticker(yf_symbol)
        hist = stock.history(period=f"{days}d", interval=interval)
        
        formatted_kline = []
        for date, row in hist.iterrows():
            if interval in ["1d", "5d", "1wk", "1mo", "3mo"]:
                time_val = date.strftime("%Y-%m-%d")
            else:
                time_val = int(date.timestamp())

            formatted_kline.append({
                "date": time_val,
                "open": round(row["Open"], 2),
                "high": round(row["High"], 2),
                "low": round(row["Low"], 2),
                "close": round(row["Close"], 2),
                "volume": int(row["Volume"])
            })
            
        return {"symbol": symbol, "kline": formatted_kline}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
