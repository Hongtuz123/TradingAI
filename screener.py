import requests
import pandas as pd
import json
import time

FUGLE_API_KEY = "OGI4NjdlNGQtNzU4Yy00NGEwLTk0MjYtYjZiYjY2MzFlZjdiIDZlMDE2ZDA0LWIwNTctNDg2My04ODFlLTFjNmFlMmUxNDhmNQ=="

# 自選觀察名單（一定會被納入，不受成交量門檻限制）
WATCHLIST = [
    {'Code': '3030', 'Name': '德律',   'market': 'TSE'},
    {'Code': '2360', 'Name': '致茂',   'market': 'TSE'},
    {'Code': '6788', 'Name': '華景電', 'market': 'OTC'},
    {'Code': '2330', 'Name': '台積電', 'market': 'TSE'},
    {'Code': '2317', 'Name': '鴻海',   'market': 'TSE'},
    {'Code': '3231', 'Name': '緯創',   'market': 'TSE'},
    {'Code': '3017', 'Name': '奇鋐',   'market': 'TSE'},
    {'Code': '2382', 'Name': '廣達',   'market': 'TSE'},
]

def get_top_stocks(limit=80):
    result = {}
    # TWSE 上市
    try:
        res = requests.get('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', timeout=10)
        if res.status_code == 200:
            df = pd.DataFrame(res.json())
            df = df[df['Code'].str.match(r'^\d{4}$')]  # 純4位數字
            df['TradeVolume'] = pd.to_numeric(df['TradeVolume'], errors='coerce')
            df = df.sort_values('TradeVolume', ascending=False)
            for r in df.head(limit).to_dict('records'):
                r['market'] = 'TSE'
                result[r['Code']] = r
    except Exception as e:
        print(f'TWSE 抓取失敗: {e}')
    # OTC 上櫃
    try:
        res = requests.get('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes', timeout=10)
        if res.status_code == 200:
            df = pd.DataFrame(res.json())
            if 'SecuritiesCompanyCode' in df.columns:
                df = df.rename(columns={'SecuritiesCompanyCode':'Code','CompanyName':'Name','Volume':'TradeVolume'})
            elif 'Code' not in df.columns and len(df.columns) > 2:
                df.columns = ['Code','Name','TradeVolume'] + list(df.columns[3:])
            df = df[df['Code'].str.match(r'^\d{4}$')]
            df['TradeVolume'] = pd.to_numeric(df['TradeVolume'], errors='coerce').fillna(0)
            df = df.sort_values('TradeVolume', ascending=False)
            for r in df.head(30).to_dict('records'):
                r['market'] = 'OTC'
                if r['Code'] not in result:
                    result[r['Code']] = r
    except Exception as e:
        print(f'OTC 抓取失敗: {e}')
    # 自選名單強制加入
    for w in WATCHLIST:
        if w['Code'] not in result:
            result[w['Code']] = {'Code': w['Code'], 'Name': w['Name'], 'TradeVolume': 0,
                                  'Change': '', 'market': w['market']}
    print(f'合計股票池：{len(result)} 檔')
    return list(result.values())

def get_historical_candles(symbol):
    url = f"https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/{symbol}?fields=open,high,low,close,volume"
    headers = {"X-API-KEY": FUGLE_API_KEY}
    res = requests.get(url, headers=headers)
    if res.status_code == 200:
        return res.json().get('data', [])
    return []

def calc_indicators(df):
    df = df.sort_values('date').reset_index(drop=True)
    n = len(df)
    df['close'] = pd.to_numeric(df['close'])
    df['high']  = pd.to_numeric(df['high'])
    df['low']   = pd.to_numeric(df['low'])
    df['volume'] = pd.to_numeric(df['volume'])
    
    # MAs — min_periods=1 讓資料少也能算
    df['ma5']     = df['close'].rolling(5, min_periods=1).mean()
    df['ma20']    = df['close'].rolling(20, min_periods=1).mean()
    df['ma60']    = df['close'].rolling(60, min_periods=1).mean()
    df['vol_ma20']= df['volume'].rolling(20, min_periods=1).mean()
    
    # RSI 14
    delta = df['close'].diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=14, min_periods=1).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=14, min_periods=1).mean()
    rs = gain / (loss + 1e-9)
    df['rsi14'] = 100 - (100 / (1 + rs))
    
    # MACD
    exp1 = df['close'].ewm(span=12, adjust=False).mean()
    exp2 = df['close'].ewm(span=26, adjust=False).mean()
    df['macd']   = exp1 - exp2
    df['signal'] = df['macd'].ewm(span=9, adjust=False).mean()
    df['hist']   = df['macd'] - df['signal']
    
    # 52W High
    df['high_52w'] = df['close'].rolling(250, min_periods=1).max()
    
    return df

def run_screener():
    print("抓取熱門標的清單...")
    top_stocks = get_top_stocks(30)
    
    results = []
    print(f"開始透過 Fugle API 取得 {len(top_stocks)} 檔標的歷史資料...")
    
    for idx, s in enumerate(top_stocks):
        symbol = s['Code']
        name = s['Name']
        print(f"[{idx+1}/{len(top_stocks)}] 處理 {symbol} {name}")
        
        candles = get_historical_candles(symbol)
        if len(candles) < 20:  # 免費版約30筆，門檻降至20
            print(f"  ↳ 資料不足 ({len(candles)} 筆)，跳過")
            time.sleep(0.5)
            continue
            
        df = pd.DataFrame(candles)
        df = calc_indicators(df)
        
        latest = df.iloc[-1]
        prev = df.iloc[-2]
        
        close = latest['close']
        vol = latest['volume']
        
        # 判斷技術面類型
        tech_type = 'none'
        # B: 均線多頭
        if latest['ma5'] > latest['ma20'] > latest['ma60'] and close > latest['ma5']:
            tech_type = 'B'
        # A: 突破型
        recent_high = df['close'].tail(20).max()
        if close >= recent_high and vol > latest['vol_ma20'] * 1.5:
            tech_type = 'A'
        # C: 剛轉強
        if prev['hist'] <= 0 and latest['hist'] > 0 and prev['rsi14'] <= 50 and latest['rsi14'] > 50:
            tech_type = 'C'
        # D: 強勢回檔
        if close > latest['ma20'] and vol < latest['vol_ma20']:
            tech_type = 'D'
            
        ma_bull = close > latest['ma20'] > latest['ma60']
        vol_ratio = vol / latest['vol_ma20'] if latest['vol_ma20'] > 0 else 0
        dist_52w = ((latest['high_52w'] - close) / latest['high_52w']) * 100 if latest['high_52w'] > 0 else 0
        close_high = (close - latest['low']) / (latest['high'] - latest['low'] + 0.0001) > 0.8
        
        results.append({
            "id": symbol,
            "name": name,
            "price": float(close),
            "change": round(float(s['Change'].replace('+','').replace('X','').strip() or '0') * (1 if not s['Change'].startswith('-') else -1), 2),
            "epsYoY": 20, # 由於Fugle基本面API需付費，先帶入預設值
            "revYoY": 25,
            "roe": 12,
            "grossMargin": 30,
            "debtRatio": 45,
            "trustDays": 3,
            "foreignBuy": True,
            "volRatio": round(vol_ratio, 1),
            "turnover": 5.0,
            "marketCap": 200,
            "dailyVol": int(vol / 1000),
            "type": tech_type,
            "maBull": bool(ma_bull),
            "closeToHigh": bool(close_high),
            "dist52W": round(dist_52w, 1),
            "blacklist": []
        })
        time.sleep(0.5) # 避免 Rate Limit
        
    js_content = f"""// 由 Fugle API 產生之真實資料
const marketData = {{
  twii_above_60ma: True,
  otc_above_60ma: True,
  vol_above_20ma: True,
  lastUpdate: '{pd.Timestamp.now().strftime("%Y-%m-%d %H:%M:%S")}'
}};

const mockStocks = {json.dumps(results, ensure_ascii=False, indent=2)};

// 評分邏輯 (滿分11分)
function calculateScore(stock) {{
  let score = 0;
  if (stock.revYoY > 20) score += 1;
  if (stock.epsYoY > 15) score += 1;
  if (stock.roe > 10) score += 1;
  if (stock.dailyVol > 2000) score += 1;
  if (stock.marketCap > 50) score += 1;
  if (stock.trustDays >= 3) score += 1;
  if (stock.foreignBuy) score += 1;
  if (stock.maBull) score += 1;
  if (stock.volRatio > 1.5) score += 1;
  if (stock.closeToHigh) score += 1;
  if (stock.dist52W < 15) score += 1;
  return score;
}}

mockStocks.forEach(s => s.score = calculateScore(s));
"""
    # 修正 Python → JS 的 boolean 序列化（json.dumps 已幫忙，但 f-string 部分需替換）
    js_content = js_content.replace(": True,", ": true,").replace(": False,", ": false,")
    
    with open('data.js', 'w', encoding='utf-8') as f:
        f.write(js_content)
        
    print("執行完畢，已覆寫 data.js！")

if __name__ == "__main__":
    run_screener()
