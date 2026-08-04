import requests
import json
import os

DISCORD_WEBHOOK_URL = os.environ.get(
    "TW_STOCK_DISCORD_WEBHOOK",
    "https://discord.com/api/webhooks/1531109521446011032/FkhYvYokdxRobnATSkkpfamBJKBEseiBmg-viPKyKvKqb7_93U5_y3Cvn4i8LgRKxj15",
)

def send_discord_batch_signals(qualified_stocks_1d=None, qualified_stocks_4h=None, scanned_cnt=0, time_str=""):
    """
    發送 Version 6 雙時框 呱呱推播卡片 至 Discord Channel
    1D 日線與 4H 隔日沖完全獨立計算爆量倍數 (volRatio_4h) 與得分 (totalScore_4h)
    """
    q1d = qualified_stocks_1d or []
    q4h = qualified_stocks_4h or []

    top_1d = q1d[:10]
    top_4h = q4h[:10]

    content_lines = []
    content_lines.append("🐸 **荳荳AI version6 呱呱推播**\n")
    content_lines.append(f"已完成 **{scanned_cnt} 檔** 標的掃描，1D 達標 **{len(q1d)} 檔**，4H 達標 **{len(q4h)} 檔**。")
    content_lines.append("**建議分數：70-80分**。\n")

    if top_1d:
        content_lines.append(f"📅 ───【 1D 日線波段精選 (共 {len(top_1d)} 檔) 】───")
        for idx, s in enumerate(top_1d, start=1):
            name_str = f"{s.get('id', '')} {s.get('name', '')}"
            price = s.get('price', 0)
            chg = s.get('change', 0)
            chg_str = f"+{chg}%" if chg >= 0 else f"{chg}%"
            vol_r = s.get('volRatio', 1.0)
            score = s.get('totalScore', 70)
            sl_price = round(price * 0.80, 2)

            content_lines.append(
                f"**標的{idx}**： {name_str}  現價：`${price:,.2f}` twd ({chg_str}) | 爆量：`{vol_r:.2f}x`均量 | 止損： `${sl_price:,.2f}` ({score}分)"
            )
        content_lines.append("")

    if top_4h:
        content_lines.append(f"⚡ ───【 4H 隔日沖精選 (共 {len(top_4h)} 檔) 】───")
        for idx, s in enumerate(top_4h, start=1):
            name_str = f"{s.get('id', '')} {s.get('name', '')}"
            price = s.get('price', 0)
            chg = s.get('change', 0)
            chg_str = f"+{chg}%" if chg >= 0 else f"{chg}%"
            # 4H 專屬爆量倍數與 4H 專屬得分
            vol_r_4h = s.get('volRatio_4h', s.get('volRatio', 1.0))
            score_4h = s.get('totalScore_4h', s.get('totalScore', 70))
            sl_price = round(price * 0.80, 2)

            content_lines.append(
                f"**標的{idx}**： {name_str}  現價：`${price:,.2f}` twd ({chg_str}) | 爆量：`{vol_r_4h:.2f}x`均量 | 止損： `${sl_price:,.2f}` (4H {score_4h}分)"
            )

    full_msg = "\n".join(content_lines)

    embed = {
        "title": "🐸 荳荳AI version6 呱呱推播",
        "description": full_msg,
        "color": 0x22c55e,  # 綠色
        "footer": {
            "text": f"🐾 荳荳 AI 選股系統 — Version 6 (70-80分黃金區間) ｜ {time_str}"
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
        print(f"❌ Discord 推播發送失敗: {e}")
        return False
