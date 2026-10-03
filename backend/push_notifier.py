import requests
import os

# OneSignal 配置 (可透過環境變數 ONESIGNAL_APP_ID 與 ONESIGNAL_REST_KEY 覆寫)
ONESIGNAL_APP_ID = os.environ.get(
    "ONESIGNAL_APP_ID",
    "5691aeec-82c3-445f-b89a-0fb2a593a51d"
)
ONESIGNAL_REST_KEY = os.environ.get(
    "ONESIGNAL_REST_KEY",
    "os_v2_app_k2i253ecyncf7oe2b6zkle5fduhyiuevwdyuhguk2rpntu5yqmi6wtb2zd46fig752rwyb7a35vhtlb3yh77c72bkwuovrz5hyvpewy"
)

ONESIGNAL_API_URL = "https://onesignal.com/api/v1/notifications"


def get_tradingview_url(symbol_code, market="TSE"):
    """自動配對 TradingView 專屬 Deep Link (支援手機原生 TradingView App 自動喚起精準股票標的)"""
    symbol_code = str(symbol_code).strip()
    prefix = "TPEX" if str(market).upper() == "OTC" else "TWSE"
    return f"tradingview://symbol/{prefix}:{symbol_code}"


def send_pwa_push_notification(buy_signals=None, add_buy_signals=None, sell_signals=None, scanned_cnt=0, time_str=""):
    """
    📱 Phase 3: 荳荳 AI 後端手機 PWA 系統原生推播發送器 (OneSignal REST API)
    發送包含 TradingView Deep Link 的手機鎖屏推播通知
    """
    buys = buy_signals or []
    adds = add_buy_signals or []
    sells = sell_signals or []

    # 🚀 硬性成交量防線與分數升冪排序 (70分起爆甜蜜點優先，同分爆量降冪)
    def _get_sort_score(s):
        sc = s.get('display_score') or s.get('totalScore') or s.get('totalScore_4h') or 70
        try: return float(sc)
        except (TypeError, ValueError): return 70.0

    def _get_vol_ratio(s):
        try: return abs(float(s.get('volRatio', 1.0) or 1.0))
        except (TypeError, ValueError): return 1.0

    def _is_qualified(s):
        code = str(s.get('id', s.get('Code', ''))).strip()
        market = str(s.get('market', '')).upper()
        name = str(s.get('name', s.get('Name', ''))).strip()
        # 🛡️ 硬性防線 1：僅允許上市 (TSE) / 上櫃 (OTC) 之普通股
        if market not in ('TSE', 'OTC'):
            return False
        # 🚫 最新規則：全面排除 ETF (00開頭) 與債券、權證、ETN、TDR
        if code.startswith('00') or s.get('isETF', False):
            return False
        if '債' in name or code.upper().endswith('B') or 'ETF' in name.upper():
            return False
        if code.startswith(('01', '02', '03', '04', '05', '06', '07', '08', '91')):
            return False
        # 僅操作純個股 (4 位純數字)
        if not (code.isdigit() and len(code) == 4):
            return False

        # 💧 硬性防線 2：殭屍股雙硬指標強制阻斷 (日均量 >= 300張 且 市值 >= 20億元)
        daily_vol = float(s.get('dailyVol', s.get('vol', 0)) or 0)
        market_cap = float(s.get('marketCap', s.get('cap', 0)) or 0)
        if daily_vol < 300:
            return False
        if 0 < market_cap < 20:
            return False

        # 🎯 硬性防線 3：入選評分門檻嚴格 >= 70 分
        score = _get_sort_score(s)
        if score < 70:
            return False

        vol_r = _get_vol_ratio(s) >= 1.2
        fn = s.get('foreignNetBuy', 0) or 0
        tr = s.get('trustDays', 0) or 0
        dl = s.get('dealerDays', 0) or 0
        inst_buy = (fn + tr + dl) > 0
        return vol_r and inst_buy

    buys = [s for s in buys if _is_qualified(s)]
    adds = [s for s in adds if _is_qualified(s)]

    buys.sort(key=lambda s: (_get_sort_score(s), -_get_vol_ratio(s)))
    adds.sort(key=lambda s: (_get_sort_score(s), -_get_vol_ratio(s)))

    if not buys and not adds and not sells:
        return True

    # 優先發送最高優質的 🟢 買進訊號，無買進則發送 🔵 加碼訊號，其次賣出
    target_stock = None
    sig_action = "買進"
    sig_emoji = "🟢"
    filter_type = "buy"

    if buys:
        target_stock = buys[0]
        sig_action = "買進"
        sig_emoji = "🟢"
        filter_type = "buy"
    elif adds:
        target_stock = adds[0]
        sig_action = "加碼"
        sig_emoji = "🔵"
        filter_type = "add"
    elif sells:
        target_stock = sells[0]
        sig_action = "賣出"
        sig_emoji = "🔴"
        filter_type = "closed"

    if not target_stock:
        return True

    code = target_stock.get('id', '')
    name = target_stock.get('name', '')
    market = target_stock.get('market', 'TSE')
    price = target_stock.get('price', 0)
    change = target_stock.get('change', 0)
    score = int(_get_sort_score(target_stock))
    vol_r = _get_vol_ratio(target_stock)
    chg_str = f"+{change:.2f}%" if change >= 0 else f"{change:.2f}%"
    
    # 格式化訊號時間 (取 HH:MM)
    if not time_str:
        from datetime import datetime, timezone, timedelta
        tz = timezone(timedelta(hours=8))
        time_display = datetime.now(tz).strftime("%H:%M")
    else:
        parts = str(time_str).strip().split()
        time_display = parts[-1][:5] if len(parts) > 1 else parts[0][:5]

    # 交易時框 (日線 + 4H 雙時框共振)
    timeframe_label = target_stock.get('timeframe', '1D+4H')

    # 🎯 規範格式：訊號時間 + 股票代碼 + 股票名稱 + 訊號(買進/賣出/加碼) + 對應交易時框
    push_title = f"{sig_emoji} [{time_display}] {code} {name} · {sig_action} ({timeframe_label})"
    push_body = f"現價 ${price:.2f} ({chg_str}) ｜ 量能放大 {vol_r:.2f}x ｜ 點擊查看荳荳精選清單 🐕"

    # 🎯 導回本系統並開啟荳荳清單對應篩選
    system_target_url = f"https://trading-ai-eosin-zeta.vercel.app/?view=screener&filter={filter_type}"

    payload = {
        "app_id": ONESIGNAL_APP_ID,
        "included_segments": ["Subscribed Users"],
        "headings": {"en": push_title, "zh": push_title},
        "contents": {"en": push_body, "zh": push_body},
        "web_url": system_target_url,
        "app_url": system_target_url,
        "data": {
            "symbol": code,
            "market": market,
            "score": score,
            "view": "screener",
            "filter": filter_type,
            "url": system_target_url
        }
    }

    # OneSignal 新版 REST Key (os_v2_app_ 開頭) 需使用 "Key" 前綴，舊版才用 "Basic"
    auth_prefix = "Key" if ONESIGNAL_REST_KEY.startswith("os_v2_app_") else "Basic"
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": f"{auth_prefix} {ONESIGNAL_REST_KEY}"
    }

    try:
        res = requests.post(ONESIGNAL_API_URL, json=payload, headers=headers, timeout=10)
        if res.status_code in (200, 202):
            print(f"📱 ✅ [Phase 3 手機推播] 成功向 OneSignal 發送推播: {push_title}")
            return True
        else:
            # 印出完整錯誤 body 方便除錯 (例如 401 / 400 的原因)
            print(f"📱 ❌ [Phase 3 手機推播] OneSignal 回傳錯誤 HTTP {res.status_code}: {res.text[:500]}")
            return False
    except Exception as e:
        print(f"📱 ⚠️ [Phase 3 手機推播] 發送異常 (不影響數據運算): {e}")
        return False
