import os
from pathlib import Path
import requests

from backend.push_notifier import filter_and_sort_signals


def _load_local_env():
    """自動自專案根目錄載入 .env.local 或 .env 中的環境變數（線下專用，嚴禁上傳 GitHub）"""
    base_dir = Path(__file__).resolve().parent.parent
    for env_name in [".env.local", ".env"]:
        env_file = base_dir / env_name
        if env_file.exists():
            try:
                with open(env_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            k = k.strip()
                            v = v.strip().strip('"').strip("'")
                            if k and k not in os.environ:
                                os.environ[k] = v
            except Exception:
                pass


_load_local_env()


def get_discord_webhook_url():
    """動態取得 Discord Webhook URL"""
    return os.environ.get("TW_STOCK_DISCORD_WEBHOOK", "").strip()


DISCORD_WEBHOOK_URL = get_discord_webhook_url()

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
        val = float(vr)
        if val <= 0.0:
            val = 1.00
        return f"{val:.2f}x"
    except (TypeError, ValueError):
        return "1.00x"


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
    sells = sell_signals or []

    # 🛡️ 與 PWA 推播 100% 同步：共用防線 (純個股/量≥300張/市值≥20億/≥70分/爆量≥1.2x/法人買超) + 分數升冪、同分爆量降冪
    buys = filter_and_sort_signals(buy_signals)
    adds = filter_and_sort_signals(add_buy_signals)

    if not buys and not adds and not sells:
        return True

    content_lines = []
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
        "title": "🐸 荳荳 AI 動態交易訊號推播（多因子評分系統）",
        "description": full_msg,
        "color": embed_color,
        "footer": {
            "text": f"🐾 荳荳 AI — 多因子風控狀態機 (買進 / 加碼買進 / 賣出) ｜ {time_str}"
        }
    }

    payload = {
        "username": "荳荳Bot",
        "embeds": [embed]
    }

    webhook_url = get_discord_webhook_url()
    if not webhook_url:
        print("⚠️ 未偵測到 TW_STOCK_DISCORD_WEBHOOK 設定，跳過 Discord 推播（請於線下 .env.local 設置）。")
        return False

    try:
        res = requests.post(webhook_url, json=payload, timeout=10)
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
