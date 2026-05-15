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

# TODO: 填入你的 Fugle API 憑證
FUGLE_API_KEY = "YOUR_FUGLE_API_KEY_HERE"
FUGLE_BASE_URL = "https://api.fugle.tw/marketdata/v1.0"

class KlineResponse(BaseModel):
    symbol: str
    kline: list

@app.get("/")
def read_root():
    return {"message": "DouDou AI Trading API is running."}

@app.get("/api/history", response_model=KlineResponse)
async def get_kline_history(symbol: str, days: int = 120):
    """
    抓取指定標的的 K 線歷史資料
    """
    # 計算時間區間
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)
    
    # 格式化為 YYYY-MM-DD
    _from = start_date.strftime("%Y-%m-%d")
    _to = end_date.strftime("%Y-%m-%d")

    # 組合 Fugle API URL (需根據 Fugle API v1.0 規範調整)
    # 注意：這裡使用示意寫法，實際 Endpoint 為 /stock/historical/candles
    url = f"{FUGLE_BASE_URL}/stock/historical/candles/{symbol}?from={_from}&to={_to}"
    
    headers = {
        "X-API-KEY": FUGLE_API_KEY
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            data = response.json()
            
            # TODO: 將 Fugle 的回應資料整理成前端 LWC 需要的格式
            # 格式: { date: "YYYY-MM-DD", open: 100, high: 105, low: 95, close: 102, volume: 1000 }
            formatted_kline = []
            if "data" in data:
                for candle in data["data"]:
                    formatted_kline.append({
                        "date": candle.get("date"),
                        "open": candle.get("open"),
                        "high": candle.get("high"),
                        "low": candle.get("low"),
                        "close": candle.get("close"),
                        "volume": candle.get("volume")
                    })
            
            # 反轉陣列確保為時間正序
            formatted_kline.reverse()
            
            return {"symbol": symbol, "kline": formatted_kline}
            
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=f"Fugle API error: {e.response.text}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
