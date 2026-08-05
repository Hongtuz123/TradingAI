import requests
import os

DISCORD_WEBHOOK_URL = os.environ.get(
    "TW_STOCK_DISCORD_WEBHOOK",
    "https://discord.com/api/webhooks/1531109521446011032/FkhYvYokdxRobnATSkkpfamBJKBEseiBmg-viPKyKvKqb7_93U5_y3Cvn4i8LgRKxj15"
)

EMBED_DESC_LIMIT = 4000  # Discord embed description 上限 4096，保留 96 字元緩衝


def _fmt_chg(chg):
    """安全格式化漲跌幅，防止 None 或非數值崩潰"""
    try:
        v = float(chg)
        return f"+{v:.2f}%" if v >= 0 else f"{v:.2f}%"
    except (TypeError, ValueError):
        return "N/A"


def _fmt_score(sc):
    """安全格式化得分，防止 None 崩潰"""
    try:
        return int(sc)
    except (TypeError, ValueError):
        return "?"


def _fmt_vol(vr):
    """安全格式化爆量倍數"""
    try:
        return f"{float(vr):.2f}x"
    except (TypeError, ValueError):
        return "?.??x"


def _fmt_price(p):
    """安全格式化價格"""
    try:
        return f"${float(p):,.2f}"
    except (TypeError, ValueError):
        return "$?.??"


def send_discord_signal_state_push(buy_signals=None, add_buy_signals=None, sell_signals=None, scanned_cnt=0, time_str=""):
    """
    發送【買進 / 加碼買進 / 賣出】三大動態交易訊號卡片至 Discord Channel
    """
    buys  = buy_signals or []
    adds  = add_buy_signals or []
    sells = sell_signals or []

    if not buys and not adds and not sells:
        return True

    content_lines = []
    content_lines.append("🐸 **荳荳 AI Version 6 動態交易訊號推播**\n")
    content_lines.append(
        f"已完成 **{scanned_cnt} 檔** 標的即時掃描。"
        f"本次觸發 🟢**{len(buys)} 筆買進**、🔵**{len(adds)} 筆加碼**、🔴**{len(sells)} 筆賣出**。\n"
    )

    # 1. 🟢 買進訊號 (首次進場，70-89 分黃金甜蜜區)
    if buys:
        top_buys = buys[:8]
        suffix = f"，精選前 {len(top_buys)} 檔" if len(buys) > 8 else f"，共 {len(buys)} 檔"
        content_lines.append(f"🟢 ───【 買進訊號 (首次進場{suffix}) 】───")
        for idx, s in enumerate(top_buys, start=1):
            name_str = f"{s.get('id', '')} {s.get('name', '')}"
            price    = s.get('price', 0) or 0
            vol_r    = _fmt_vol(s.get('volRatio'))
            score    = _fmt_score(s.get('display_score', s.get('totalScore')))
            tf_tag   = s.get('tf_tag', '1D')
            chg_str  = _fmt_chg(s.get('change'))
            sl_str   = f" ｜ 止損 `{_fmt_price(price * 0.80)}`" if price > 0 else ""
            content_lines.append(
                f"**[買進 {idx}]** {name_str} ｜ `{_fmt_price(price)}` ({chg_str}) ｜ 爆量 `{vol_r}`{sl_str} ({tf_tag} **{score}分**)"
            )
        content_lines.append("")

    # 2. 🔵 加碼買進訊號 (持倉中強勢突破 / 大爆量升分)
    if adds:
        top_adds = adds[:5]
        suffix = f"，精選前 {len(top_adds)} 檔" if len(adds) > 5 else f"，共 {len(adds)} 檔"
        content_lines.append(f"🔵 ───【 加碼買進 (持倉轉強{suffix}) 】───")
        for idx, s in enumerate(top_adds, start=1):
            name_str = f"{s.get('id', '')} {s.get('name', '')}"
            price    = s.get('price', 0) or 0
            vol_r    = _fmt_vol(s.get('volRatio'))
            score    = _fmt_score(s.get('display_score', s.get('totalScore')))
            chg_str  = _fmt_chg(s.get('change'))
            reason   = s.get('add_reason', '強勢突破爆量') or '強勢突破爆量'
            content_lines.append(
                f"**[加碼 {idx}]** {name_str} ｜ `{_fmt_price(price)}` ({chg_str}) ｜ 爆量 `{vol_r}` ｜ {reason} (**{score}分**)"
            )
        content_lines.append("")

    # 3. 🔴 賣出訊號 (風控平倉 / 停損觸發)
    if sells:
        top_sells = sells[:8]
        content_lines.append(f"🔴 ───【 賣出訊號 (立即平倉，共 {len(sells)} 檔) 】───")
        for idx, s in enumerate(top_sells, start=1):
            name_str = f"{s.get('id', '')} {s.get('name', '')}"
            price    = s.get('price', 0) or 0
            chg_str  = _fmt_chg(s.get('change'))
            reason   = s.get('sell_reason', 'SuperTrend 趨勢轉為空頭') or 'SuperTrend 趨勢轉為空頭'
            content_lines.append(
                f"**[賣出 {idx}]** {name_str} ｜ `{_fmt_price(price)}` ({chg_str}) ｜ 原因：`{reason}`"
            )

    full_msg = "\n".join(content_lines)

    # 確保 description 不超過 Discord 4096 字元上限
    if len(full_msg) > EMBED_DESC_LIMIT:
        full_msg = full_msg[:EMBED_DESC_LIMIT] + "\n…（訊號過多已截斷，詳見網站）"

    # 顏色：純賣出時顯示紅色，否則顯示綠色
    embed_color = 0xef4444 if (sells and not buys and not adds) else 0x22c55e

    embed = {
        "title": "🐸 荳荳 AI Version 6 動態交易訊號推播",
        "description": full_msg,
        "color": embed_color,
        "footer": {
            "text": f"🐾 荳荳 AI — 動態訊號狀態機 (買進 / 加碼買進 / 賣出) ｜ {time_str}"
        }
    }

    payload = {
        "username": "荳荳Bot",
        "embeds": [embed]
    }

    try:
        res = requests.post(DISCORD_WEBHOOK_URL, json=payload, timeout=10)
        return res.status_code in (200, 204)
    except Exception as e:
        print(f"❌ Discord 訊號推播發送失敗: {e}")
        return False


def send_discord_batch_signals(qualified_stocks_1d=None, qualified_stocks_4h=None, scanned_cnt=0, time_str=""):
    """向下相容之靜態發送函式"""
    return send_discord_signal_state_push(
        buy_signals=qualified_stocks_1d[:5] if qualified_stocks_1d else None,
        add_buy_signals=qualified_stocks_4h[:3] if qualified_stocks_4h else None,
        sell_signals=None,
        scanned_cnt=scanned_cnt,
        time_str=time_str
    )
