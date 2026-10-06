import json
import os
from pathlib import Path

# ===== 🛡️ 原生 Web Push (VAPID / RFC 8292) 配置 =====
DEFAULT_VAPID_CLAIMS_EMAIL = "doudou.trading.ai@gmail.com"
SUBSCRIPTIONS_FILE = Path(__file__).resolve().parent / "subscriptions.json"


def _load_env_local():
    """動態載入 .env.local 中的環境變數"""
    env_path = Path(__file__).resolve().parent.parent / ".env.local"
    if env_path.exists():
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k not in os.environ:
                    os.environ[k] = v


def _get_vapid_config():
    _load_env_local()
    private_key = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
    email = os.environ.get("VAPID_CLAIMS_EMAIL", "").strip() or DEFAULT_VAPID_CLAIMS_EMAIL
    return private_key, email


def load_subscriptions():
    """載入所有已登記之原生 Web Push 設備門牌"""
    if not SUBSCRIPTIONS_FILE.exists():
        return []
    try:
        with open(SUBSCRIPTIONS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception as e:
        print(f"⚠️ 讀取 subscriptions.json 異常: {e}")
        return []


def save_subscriptions(subs):
    """保存設備門牌清單"""
    try:
        with open(SUBSCRIPTIONS_FILE, "w", encoding="utf-8") as f:
            json.dump(subs, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"⚠️ 寫入 subscriptions.json 異常: {e}")


def register_new_subscription(sub_dict):
    """登記或更新一個設備門牌"""
    if not isinstance(sub_dict, dict) or "endpoint" not in sub_dict:
        return False
    subs = load_subscriptions()
    endpoint = sub_dict.get("endpoint")
    # 去重並更新
    filtered = [s for s in subs if s.get("endpoint") != endpoint]
    filtered.append(sub_dict)
    save_subscriptions(filtered)
    print(f"📱 ✅ 成功登記原生推播設備門牌 (目前總共 {len(filtered)} 台裝置)")
    return True


# ===== 🛡️ 推播共用防線 (PWA 與 Discord 100% 同步引用) =====
def get_sort_score(s):
    sc = s.get('display_score') or s.get('totalScore') or s.get('totalScore_4h') or 70
    try: return float(sc)
    except (TypeError, ValueError): return 70.0


def get_vol_ratio(s):
    try: return abs(float(s.get('volRatio', 1.0) or 1.0))
    except (TypeError, ValueError): return 1.0


def is_push_qualified(s):
    code = str(s.get('id', s.get('Code', ''))).strip()
    market = str(s.get('market', '')).upper()
    name = str(s.get('name', s.get('Name', ''))).strip()
    # 🛡️ 硬性防線 1：僅允許上市 (TSE) / 上櫃 (OTC) 之普通股
    if market not in ('TSE', 'OTC'):
        return False
    # 🚫 全面排除 ETF (00開頭) 與債券、權證、ETN、TDR
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
    if get_sort_score(s) < 70:
        return False

    vol_r = get_vol_ratio(s) >= 1.2
    fn = s.get('foreignNetBuy', 0) or 0
    tr = s.get('trustDays', 0) or 0
    dl = s.get('dealerDays', 0) or 0
    inst_buy = (fn + tr + dl) > 0
    return vol_r and inst_buy


def filter_and_sort_signals(signals):
    """套用共用防線，並依【分數升冪 (70分甜蜜點優先)、同分爆量降冪】排序"""
    out = [s for s in (signals or []) if is_push_qualified(s)]
    out.sort(key=lambda s: (get_sort_score(s), -get_vol_ratio(s)))
    return out


def get_tradingview_url(symbol_code, market="TSE"):
    """自動配對 TradingView 專屬 Deep Link"""
    symbol_code = str(symbol_code).strip()
    prefix = "TPEX" if str(market).upper() == "OTC" else "TWSE"
    return f"tradingview://symbol/{prefix}:{symbol_code}"


def send_pwa_push_notification(buy_signals=None, add_buy_signals=None, sell_signals=None, scanned_cnt=0, time_str=""):
    """
    📱 Phase 3: 荳荳 AI 原生標準 Web Push 直連推播發送器 (直連 Apple APNs / RFC 8292)
    """
    sells = sell_signals or []

    # 🚀 共用防線 + 分數升冪排序 (70分起爆甜蜜點優先，同分爆量降冪)
    buys = filter_and_sort_signals(buy_signals)
    adds = filter_and_sort_signals(add_buy_signals)

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
    score = int(get_sort_score(target_stock))
    vol_r = get_vol_ratio(target_stock)
    chg_str = f"+{change:.2f}%" if change >= 0 else f"{change:.2f}%"

    # 格式化訊號時間 (取 HH:MM)
    if not time_str:
        from datetime import datetime, timezone, timedelta
        tz = timezone(timedelta(hours=8))
        time_display = datetime.now(tz).strftime("%H:%M")
    else:
        parts = str(time_str).strip().split()
        time_display = parts[-1][:5] if len(parts) > 1 else parts[0][:5]

    timeframe_label = target_stock.get('timeframe', '1D+4H')

    # 🎯 規範格式：訊號時間 + 股票代碼 + 股票名稱 + 訊號(買進/賣出/加碼) + 對應交易時框
    push_title = f"{sig_emoji} [{time_display}] {code} {name} · {sig_action} ({timeframe_label})"
    push_body = f"現價 ${price:.2f} ({chg_str}) ｜ 量能放大 {vol_r:.2f}x ｜ 點擊查看荳荳精選清單 🐕"
    system_target_url = f"https://trading-ai-eosin-zeta.vercel.app/?view=screener&filter={filter_type}"

    payload = {
        "title": push_title,
        "body": push_body,
        "tag": f"doudou-{code}-{int(datetime.now().timestamp()) if 'datetime' in locals() else 0}",
        "data": {
            "symbol": code,
            "market": market,
            "score": score,
            "view": "screener",
            "filter": filter_type,
            "url": system_target_url
        }
    }

    private_key, claims_email = _get_vapid_config()
    if not private_key:
        print("📱 ⚠️ 未設定 VAPID_PRIVATE_KEY (.env.local)，跳過原生 Web Push。")
        return False

    subs = load_subscriptions()
    if not subs:
        print("📱 ℹ️ 目前尚未有設備登記原生推播門牌 (subscriptions.json 為空)。")
        return True

    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        print("📱 ⚠️ 未安裝 pywebpush，請執行 pip install pywebpush")
        return False

    success_cnt = 0
    expired_endpoints = set()

    payload_json = json.dumps(payload, ensure_ascii=False)
    vapid_claims = {"sub": f"mailto:{claims_email}"}

    for sub in subs:
        endpoint = sub.get("endpoint", "")
        try:
            res = webpush(
                subscription_info=sub,
                data=payload_json,
                vapid_private_key=private_key,
                vapid_claims=vapid_claims,
                timeout=10
            )
            print(f"📱 ✅ [原生推播] 直連發送成功 ({endpoint[:35]}...): HTTP {res.status_code}")
            success_cnt += 1
        except WebPushException as ex:
            print(f"📱 ❌ [原生推播] 發送失敗 ({endpoint[:35]}...): {ex}")
            # 若為 404 / 410 Gone，表示設備已取消授權或門牌過期，自動標記清理
            if ex.response and ex.response.status_code in (404, 410):
                expired_endpoints.add(endpoint)
        except Exception as e:
            print(f"📱 ⚠️ [原生推播] 網路異常: {e}")

    # 自動清理已過期門牌
    if expired_endpoints:
        active_subs = [s for s in subs if s.get("endpoint") not in expired_endpoints]
        save_subscriptions(active_subs)
        print(f"📱 🧹 自動清理 {len(expired_endpoints)} 個過期推播設備。")

    print(f"📱 🎉 [Phase 3 原生推播] 完成：{success_cnt}/{len(subs)} 台裝置成功推達！")
    return success_cnt > 0
