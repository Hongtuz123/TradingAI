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

    # 格式化訊號時間 (取 HH:MM)
    from datetime import datetime, timezone, timedelta
    if not time_str:
        tz = timezone(timedelta(hours=8))
        time_display = datetime.now(tz).strftime("%H:%M")
    else:
        parts = str(time_str).strip().split()
        time_display = parts[-1][:5] if len(parts) > 1 else parts[0][:5]

    def _fmt_stock_item(s):
        c = str(s.get('id', '')).strip()
        n = str(s.get('name', '')).strip()
        p = float(s.get('price', 0) or 0)
        chg = float(s.get('change', 0) or 0)
        chg_str = f"+{chg:.2f}%" if chg >= 0 else f"{chg:.2f}%"
        p_str = f"${p:,.2f}" if p >= 100 else f"${p:.2f}"
        return f"{c} {n} {p_str} ({chg_str})"

    active_types = [t for t, lst in [('buy', buys), ('add', adds), ('closed', sells)] if lst]

    if len(active_types) > 1:
        # ⚡️ 跨類型混合訊號：全數合併為單一則推播
        total_count = len(buys) + len(adds) + len(sells)
        filter_type = "buy" if buys else ("add" if adds else "closed")
        primary_stock = (buys or adds or sells)[0]
        sig_code = primary_stock.get('id', '')
        primary_score = int(get_sort_score(primary_stock))
        primary_market = primary_stock.get('market', 'TSE')

        summary_parts = []
        if buys: summary_parts.append(f"買進 {len(buys)}")
        if adds: summary_parts.append(f"加碼 {len(adds)}")
        if sells: summary_parts.append(f"賣出 {len(sells)}")

        push_title = f"⚡️ [{time_display}] 荳荳 AI 觸發 {total_count} 檔訊號 ({' · '.join(summary_parts)})"

        detail_parts = []
        if buys:
            b_str = "、".join([_fmt_stock_item(s) for s in buys[:2]])
            if len(buys) > 2: b_str += f" 等共 {len(buys)} 檔"
            detail_parts.append(f"🟢買進: {b_str}")
        if adds:
            a_str = "、".join([_fmt_stock_item(s) for s in adds[:2]])
            if len(adds) > 2: a_str += f" 等共 {len(adds)} 檔"
            detail_parts.append(f"🔵加碼: {a_str}")
        if sells:
            s_str = "、".join([_fmt_stock_item(s) for s in sells[:2]])
            if len(sells) > 2: s_str += f" 等共 {len(sells)} 檔"
            detail_parts.append(f"🔴賣出: {s_str}")

        push_body = " ｜ ".join(detail_parts) + " 🐕"

    elif buys:
        filter_type = "buy"
        count = len(buys)
        primary_stock = buys[0]
        sig_code = primary_stock.get('id', '')
        primary_score = int(get_sort_score(primary_stock))
        primary_market = primary_stock.get('market', 'TSE')
        
        if count == 1:
            p_val = float(primary_stock.get('price', 0) or 0)
            p_str = f"${p_val:,.2f}" if p_val >= 100 else f"${p_val:.2f}"
            chg = float(primary_stock.get('change', 0) or 0)
            chg_str = f"+{chg:.2f}%" if chg >= 0 else f"{chg:.2f}%"
            vol_r = get_vol_ratio(primary_stock)
            tf_label = primary_stock.get('timeframe', '1D+4H')
            
            push_title = f"🟢 [{time_display}] {sig_code} {primary_stock.get('name', '')} · 買進 ({tf_label})"
            push_body = f"觸發價 {p_str} ({chg_str}) ｜ 量能放大 {vol_r:.2f}x ｜ 點擊查看荳荳清單 🐕"
        else:
            items_str = "、".join([_fmt_stock_item(s) for s in buys[:3]])
            if count > 3:
                items_str += f" 等共 {count} 檔"
            push_title = f"🟢 [{time_display}] 荳荳 AI 觸發 {count} 檔精選買進！"
            push_body = f"{items_str} 帶量起爆，點擊立即查看買進清單 🐕"

    elif adds:
        filter_type = "add"
        count = len(adds)
        primary_stock = adds[0]
        sig_code = primary_stock.get('id', '')
        primary_score = int(get_sort_score(primary_stock))
        primary_market = primary_stock.get('market', 'TSE')

        if count == 1:
            p_val = float(primary_stock.get('price', 0) or 0)
            p_str = f"${p_val:,.2f}" if p_val >= 100 else f"${p_val:.2f}"
            chg = float(primary_stock.get('change', 0) or 0)
            chg_str = f"+{chg:.2f}%" if chg >= 0 else f"{chg:.2f}%"
            vol_r = get_vol_ratio(primary_stock)
            tf_label = primary_stock.get('timeframe', '1D+4H')

            push_title = f"🔵 [{time_display}] {sig_code} {primary_stock.get('name', '')} · 加碼 ({tf_label})"
            push_body = f"觸發價 {p_str} ({chg_str}) ｜ 量能放大 {vol_r:.2f}x ｜ 點擊查看荳荳清單 🐕"
        else:
            items_str = "、".join([_fmt_stock_item(s) for s in adds[:3]])
            if count > 3:
                items_str += f" 等共 {count} 檔"
            push_title = f"🔵 [{time_display}] 荳荳 AI 觸發 {count} 檔加碼訊號！"
            push_body = f"{items_str} 突破加碼，點擊立即查看加碼清單 🐕"

    elif sells:
        filter_type = "closed"
        count = len(sells)
        primary_stock = sells[0]
        sig_code = primary_stock.get('id', '')
        primary_score = int(get_sort_score(primary_stock))
        primary_market = primary_stock.get('market', 'TSE')

        if count == 1:
            p_val = float(primary_stock.get('price', 0) or 0)
            p_str = f"${p_val:,.2f}" if p_val >= 100 else f"${p_val:.2f}"
            chg = float(primary_stock.get('change', 0) or 0)
            chg_str = f"+{chg:.2f}%" if chg >= 0 else f"{chg:.2f}%"

            push_title = f"🔴 [{time_display}] {sig_code} {primary_stock.get('name', '')} · 賣出"
            push_body = f"觸發價 {p_str} ({chg_str}) ｜ 跌破防守停損位，點擊查看已賣出清單 🐕"
        else:
            items_str = "、".join([_fmt_stock_item(s) for s in sells[:3]])
            if count > 3:
                items_str += f" 等共 {count} 檔"
            push_title = f"🔴 [{time_display}] 荳荳 AI 觸發 {count} 檔賣出訊號！"
            push_body = f"{items_str} 觸發防守離場，點擊立即查看已賣出清單 🐕"

    system_target_url = f"https://trading-ai-eosin-zeta.vercel.app/?view=screener&filter={filter_type}"

    payload = {
        "title": push_title,
        "body": push_body,
        "tag": f"doudou-{filter_type}-{int(datetime.now().timestamp())}",
        "data": {
            "symbol": sig_code,
            "market": primary_market,
            "score": primary_score,
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
