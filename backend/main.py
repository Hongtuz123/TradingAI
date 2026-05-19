from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import httpx
from datetime import datetime, timedelta
from pydantic import BaseModel
import os

app = FastAPI(title="DouDou AI Stock Backend")

# 允許前端跨域請求 (CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 測試階段允許所有來源，上線時需限縮
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 填入你的 Fugle API 憑證
FUGLE_API_KEY = "8eb1a84c-6d81-443f-80b7-bae3215a0639"
FUGLE_BASE_URL = "https://api.fugle.tw/marketdata/v1.0"

class KlineResponse(BaseModel):
    symbol: str
    kline: list

# 原本的 "/" 路由已移除，改由 StaticFiles 託管前端網頁


import yfinance as yf

@app.get("/api/history", response_model=KlineResponse)
async def get_kline_history(symbol: str, days: int = 120, interval: str = "1d"):
    """
    抓取指定標的 (透過 yfinance)
    """
    # 判斷是否為台股，若全為數字則假設為台股並加上 .TW
    yf_symbol = symbol
    if symbol.isdigit():
        yf_symbol = f"{symbol}.TW"
    
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

# 取得專案根目錄，並掛載靜態檔案服務以託管前端頁面
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
app.mount("/", StaticFiles(directory=BASE_DIR, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
