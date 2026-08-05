import requests
import json
import os

DISCORD_WEBHOOK_URL = os.environ.get(
    "TW_STOCK_DISCORD_WEBHOOK",
    "https://discord.com/api/webhooks/1531109521446011032/FkhYvYokdxRobnATSkkpfamBJKBEseiBmg-viPKyKvKqb7_93U5_y3Cvn4i8LgRKxj15"
)

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
    content_lines.append(f"已完成 **{scanned_cnt} 檔** 標的即時掃描。本次共觸發 **{len(buys)} 筆買進**、**{len(adds)} 筆加碼**、**{len(sells)} 筆賣出**訊號。\n")

    # 1. 🟢 買進訊號 (首次發動 70-89分)
    if buys:
        content_lines.append(f"🟢 ───【 買進訊號 (首次發動, 共 {len(buys[:8])} 檔) 】───")
        for idx, s in enumerate(buys[:8], start=1):
            name_str = f"{s.get('id', '')} {s.get('name', '')}"
            price    = s.get('price', 0)
            chg      = s.get('change', 0)
            chg_str  = f"+{chg}%" if chg >= 0 else f"{chg}%"
            vol_r    = s.get('volRatio', 1.0)
            score    = s.get('totalScore', 70)
            sl_price = round(price * 0.80, 2)
            tf_tag   = s.get('tf_tag', '1D')

            content_lines.append(
                f"**[買進 {idx}]** {name_str} ｜ 現價 `${price:,.2f}` ({chg_str}) ｜ 爆量 `{vol_r:.2f}x` ｜ 止損 `${sl_price:,.2f}` ({tf_tag} {score}分)"
            )
        content_lines.append("")

    # 2. 🔵 加碼買進訊號 (持倉中強勢突破/爆量升分)
    if adds:
        content_lines.append(f"🔵 ───【 加碼買進 (持倉轉強, 共 {len(adds[:8])} 檔) 】───")
        for idx, s in enumerate(adds[:8], start=1):
            name_str = f"{s.get('id', '')} {s.get('name', '')}"
            price    = s.get('price', 0)
            chg      = s.get('change', 0)
            chg_str  = f"+{chg}%" if chg >= 0 else f"{chg}%"
            vol_r    = s.get('volRatio', 1.0)
            score    = s.get('totalScore', 70)
            reason   = s.get('add_reason', '分數升至甜蜜區+爆量加強')

            content_lines.append(
                f"**[加碼 {idx}]** {name_str} ｜ 現價 `${price:,.2f}` ({chg_str}) ｜ 爆量 `{vol_r:.2f}x` ｜ `{reason}` ({score}分)"
            )
        content_lines.append("")

    # 3. 🔴 賣出訊號 (風控停損 / 防禦平倉)
    if sells:
        content_lines.append(f"🔴 ───【 賣出訊號 (風控平倉, 共 {len(sells[:8])} 檔) 】───")
        for idx, s in enumerate(sells[:8], start=1):
            name_str = f"{s.get('id', '')} {s.get('name', '')}"
            price    = s.get('price', 0)
            chg      = s.get('change', 0)
            chg_str  = f"+{chg}%" if chg >= 0 else f"{chg}%"
            reason   = s.get('sell_reason', 'SuperTrend 翻紅反轉')

            content_lines.append(
                f"**[賣出 {idx}]** {name_str} ｜ 現價 `${price:,.2f}` ({chg_str}) ｜ 觸發原因：`{reason}`"
            )

    full_msg = "\n".join(content_lines)

    embed_color = 0x22c55e if (buys or adds) else 0xef4444

    embed = {
        "title": "🐸 荳荳 AI Version 6 動態交易訊號推播",
        "description": full_msg,
        "color": embed_color,
        "footer": {
            "text": f"🐾 荳荳 AI 選股系統 — 動態訊號狀態機 (買進 / 加碼買進 / 賣出) ｜ {time_str}"
        }
    }

    payload = {
        "username": "荳荳Bot",
        "embeds": [embed]
    }

    try:
        res = requests.post(DISCORD_WEBHOOK_URL, json=payload, timeout=10)
        return res.status_code == 204 or res.status_code == 200
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
