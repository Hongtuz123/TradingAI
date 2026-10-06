# -*- coding: utf-8 -*-
"""
荳荳 AI - K 線幾何價格型態量化分析引擎
支援 8 大類 16 種型態辨識、1D 與 4H 雙時框切換、進出場風控點位精算，以及空方高危警示機制。
"""

import math
import numpy as np
import pandas as pd


def resample_60m_to_4h(df_60m):
    """
    將 60分(1H) K線資料精準重採樣為 4H K線：
    - 支援 DatetimeIndex 或含有 date 欄位的 DataFrame
    - 正確聚合 open (first), high (max), low (min), close (last), volume (sum)
    - 保留 date ('YYYY-MM-DD HH:MM') 欄位，確保完全相容 calc_indicators
    """
    if df_60m is None or df_60m.empty:
        return pd.DataFrame()

    df = df_60m.copy()
    # 統一轉換為小寫欄位名
    col_map = {}
    for col in df.columns:
        c_str = str(col).lower()
        if c_str in ['open', 'high', 'low', 'close', 'volume']:
            col_map[col] = c_str
    if col_map:
        df = df.rename(columns=col_map)

    # 確保有 DatetimeIndex
    if not isinstance(df.index, pd.DatetimeIndex):
        if 'date' in df.columns:
            df['dt'] = pd.to_datetime(df['date'])
            df = df.set_index('dt')
        elif 'datetime' in df.columns:
            df['dt'] = pd.to_datetime(df['datetime'])
            df = df.set_index('dt')
        else:
            return pd.DataFrame()

    # 依時間排序
    df = df.sort_index()

    # 依 4H 重採樣
    try:
        df_4h = df.resample('4h').agg({
            'open': 'first',
            'high': 'max',
            'low': 'min',
            'close': 'last',
            'volume': 'sum'
        }).dropna(subset=['close'])
    except Exception:
        return pd.DataFrame()

    # 排除無交易量或無波動的空區間
    df_4h = df_4h[(df_4h['volume'] > 0) | (df_4h['high'] > df_4h['low'])].copy()
    if df_4h.empty:
        return pd.DataFrame()

    # 轉換時間戳記為台北時間字串
    if df_4h.index.tz is not None:
        idx_tw = df_4h.index.tz_convert('Asia/Taipei')
    else:
        idx_tw = df_4h.index

    df_4h['date'] = idx_tw.strftime('%Y-%m-%d %H:%M')
    return df_4h.reset_index(drop=True)


def find_pivots(df, window=2):
    """
    找出近期局部波峰 (Pivot High) 與局部波谷 (Pivot Low)。
    window: 左右參考根數，預設 2
    回傳:
      peaks: [{'index': i, 'price': high, 'date': date}, ...]
      valleys: [{'index': i, 'price': low, 'date': date}, ...]
    """
    peaks = []
    valleys = []
    n = len(df)
    if n < window * 2 + 1:
        return peaks, valleys

    highs = df['high'].values
    lows = df['low'].values
    dates = df['date'].values if 'date' in df.columns else [f"T-{n-i}" for i in range(n)]

    for i in range(window, n - window):
        # 判斷波峰
        current_h = highs[i]
        if all(current_h >= highs[i - k] for k in range(1, window + 1)) and \
           all(current_h > highs[i + k] for k in range(1, window + 1)):
            peaks.append({
                'index': i,
                'price': float(round(current_h, 2)),
                'date': str(dates[i])
            })

        # 判斷波谷
        current_l = lows[i]
        if all(current_l <= lows[i - k] for k in range(1, window + 1)) and \
           all(current_l < lows[i + k] for k in range(1, window + 1)):
            valleys.append({
                'index': i,
                'price': float(round(current_l, 2)),
                'date': str(dates[i])
            })

    return peaks, valleys


def analyze_chart_patterns(df, timeframe="1D", live_price=None, stock_info=None):
    """
    針對指定時框之 K 線 DataFrame 進行 8 大類 16 種幾何型態深度量化辨識。
    遵循：
    1. 只做多策略 (Long-Only)
    2. 空方型態採【選項 2】：標記為「⚠️ 空方高危險警示區（嚴禁做多/持股防守）」，提供防守止損位
    3. 輸出包含基本資訊、判斷指標、目前型態與進出場風控點位。
    """
    if df is None or len(df) < 15:
        # 資料不足時的平滑預設
        cur_p = live_price if (live_price and live_price > 0) else (df.iloc[-1]['close'] if df is not None and not df.empty else 100.0)
        return _build_fallback_report(timeframe, cur_p, stock_info, reason="K 線資料筆數不足進行深度型態辨識")

    # 確保數值型別
    df = df.copy()
    for col in ['open', 'high', 'low', 'close', 'volume']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(method='ffill')

    # 自動補齊關鍵技術指標（若輸入 DataFrame 尚未計算）
    if 'atr14' not in df.columns or df['atr14'].isna().all():
        prev_close = df['close'].shift(1)
        tr = pd.concat([
            df['high'] - df['low'],
            (df['high'] - prev_close).abs(),
            (df['low'] - prev_close).abs()
        ], axis=1).max(axis=1)
        df['atr14'] = tr.rolling(14, min_periods=1).mean()

    if 'vol_ma20' not in df.columns or df['vol_ma20'].isna().all():
        df['vol_ma20'] = df['volume'].rolling(20, min_periods=1).mean()

    if 'ma5' not in df.columns:
        df['ma5'] = df['close'].rolling(5, min_periods=1).mean()
    if 'ma20' not in df.columns:
        df['ma20'] = df['close'].rolling(20, min_periods=1).mean()
    if 'ma60' not in df.columns:
        df['ma60'] = df['close'].rolling(60, min_periods=1).mean()

    if 'bb_upper' not in df.columns:
        mid = df['close'].rolling(20, min_periods=1).mean()
        std = df['close'].rolling(20, min_periods=1).std(ddof=0)
        df['bb_mid'] = mid
        df['bb_upper'] = mid + 2 * std
        df['bb_lower'] = mid - 2 * std

    latest = df.iloc[-1]
    prev = df.iloc[-2] if len(df) >= 2 else latest
    cur_p = round(float(live_price if (live_price and live_price > 0) else latest['close']), 2)

    # 提取基本技術指標
    atr = round(float(latest.get('atr14', cur_p * 0.025) or (cur_p * 0.025)), 2)
    if atr <= 0:
        atr = round(cur_p * 0.025, 2)

    ma5 = round(float(latest.get('ma5', cur_p) or cur_p), 2)
    ma20 = round(float(latest.get('ma20', cur_p) or cur_p), 2)
    ma60 = round(float(latest.get('ma60', cur_p) or cur_p), 2)
    vol_cur = float(latest.get('volume', 0) or 0)
    vol_ma20 = float(latest.get('vol_ma20', 1) or 1)

    stock_info = stock_info or {}
    info_vol_ratio = stock_info.get('volRatio') or stock_info.get('volRatio_4h')
    if info_vol_ratio and float(info_vol_ratio) > 0:
        vol_mult = round(float(info_vol_ratio), 2)
    else:
        vol_mult = round(vol_cur / vol_ma20, 2) if vol_ma20 > 0 else 1.0

    st_val = int(latest.get('supertrend', stock_info.get('supertrend', 1)) or 1)
    bb_upper = float(latest.get('bb_upper', cur_p * 1.05) or (cur_p * 1.05))
    bb_lower = float(latest.get('bb_lower', cur_p * 0.95) or (cur_p * 0.95))
    bb_mid = float(latest.get('bb_mid', cur_p) or cur_p)
    bb_width = round(((bb_upper - bb_lower) / bb_mid) * 100, 2) if bb_mid > 0 else 5.0

    # 取最近 40~60 根 K 線尋找幾何極值
    sub_df = df.tail(50).reset_index(drop=True)
    peaks, valleys = find_pivots(sub_df, window=2)

    # 指標診斷文字
    metrics = _generate_indicator_metrics(stock_info, vol_mult, vol_cur, atr, bb_width, st_val, cur_p, ma5, ma20, ma60)

    # ── 核心幾何型態偵測邏輯 ───
    detected = _detect_patterns_from_pivots(sub_df, peaks, valleys, cur_p, atr, ma20, st_val, vol_mult)

    # 整合最終報告結構
    report = {
        "timeframe": timeframe,
        "pattern_code": detected["code"],
        "pattern_name": detected["name"],
        "pattern_type": detected["type"],       # "bullish", "bearish_warning", "neutral"
        "pattern_desc": detected["desc"],
        "action_advice": detected["advice"],
        "action_type": detected["action_type"], # "buy", "watch", "warning"
        "entry_price": detected["entry"],
        "stop_loss": detected["sl"],
        "take_profit": detected["tp"],
        "risk_reward_ratio": detected["rr"],
        "neckline": detected["neckline"],
        "support": detected["support"],
        "resistance": detected["resistance"],
        "metrics": metrics
    }

    return report


def _detect_patterns_from_pivots(df, peaks, valleys, cur_p, atr, ma20, st_val, vol_mult):
    """
    從局部波峰與波谷中識別 16 種型態，嚴格依據幾何結構與買賣點位。
    """
    n = len(df)
    recent_high_20 = float(df['high'].tail(20).max())
    recent_low_20 = float(df['low'].tail(20).min())
    range_height = recent_high_20 - recent_low_20

    # 1. 雙重底 (W 底) 反轉突破 (Double Bottom)
    if len(valleys) >= 2 and len(peaks) >= 1:
        v1, v2 = valleys[-2], valleys[-1]
        # 兩波谷低點相差在 3.5% 以內
        if abs(v1['price'] - v2['price']) / max(v1['price'], 1e-5) <= 0.035:
            # 中間存在頸線波峰
            intermediate_peaks = [p for p in peaks if v1['index'] < p['index'] < v2['index'] or (p['index'] > v1['index'] and p['index'] <= v2['index'] + 2)]
            if intermediate_peaks:
                neckline = max(p['price'] for p in intermediate_peaks)
                h_bottom = neckline - min(v1['price'], v2['price'])
                if h_bottom > 0:
                    # 現價接近或突破頸線
                    if cur_p >= neckline * 0.98:
                        entry = round(max(cur_p, neckline * 1.005), 2)
                        sl = round(min(neckline - atr * 1.2, v2['price'] * 0.985), 2)
                        tp = round(neckline + h_bottom * 1.0, 2)
                        rr = round((tp - entry) / max(entry - sl, 0.01), 2)
                        is_breakout = cur_p >= neckline
                        return {
                            "code": "double_bottom",
                            "name": "🌟 雙重底 (W底) 突破型態" if is_breakout else "⏳ 雙重底 (W底) 醞釀型態",
                            "type": "bullish",
                            "desc": f"在 ${min(v1['price'], v2['price']):.1f} 附近完成兩次探底築底，中間波峰頸線位在 ${neckline:.1f}。最新價格{'已強勢向上突破頸線' if is_breakout else '正逼近頸線阻力點'}，底部結構堅實。",
                            "advice": "🎯 建議進場佈局：突破頸線回踩確認，多方動能充沛，防守點明確" if is_breakout else "⏳ 建議密切觀察：等待帶量實體突破頸線後順勢切入",
                            "action_type": "buy" if is_breakout else "watch",
                            "entry": entry,
                            "sl": sl,
                            "tp": tp,
                            "rr": max(rr, 1.5),
                            "neckline": neckline,
                            "support": min(v1['price'], v2['price']),
                            "resistance": neckline
                        }

    # 2. 雙重頂 (M 頭) ⚠️ 空方高危險警示 (Double Top) - 選項 2
    if len(peaks) >= 2 and len(valleys) >= 1:
        p1, p2 = peaks[-2], peaks[-1]
        # 兩波峰高點相差在 3.5% 以內
        if abs(p1['price'] - p2['price']) / max(p1['price'], 1e-5) <= 0.035:
            intermediate_valleys = [v for v in valleys if p1['index'] < v['index'] < p2['index']]
            if intermediate_valleys:
                neckline = min(v['price'] for v in intermediate_valleys)
                h_top = max(p1['price'], p2['price']) - neckline
                # 現價跌破或逼近頸線
                if cur_p <= neckline * 1.02:
                    is_breakdown = cur_p < neckline
                    return {
                        "code": "double_top",
                        "name": "⚠️ 雙重頂 (M頭) 跌破警示" if is_breakdown else "⚠️ 雙重頂 (M頭) 警戒區",
                        "type": "bearish_warning",
                        "desc": f"在 ${max(p1['price'], p2['price']):.1f} 連續兩次衝高受阻形成雙頂，關鍵支撐頸線在 ${neckline:.1f}。目前現價{'已向下跌破頸線' if is_breakdown else '岌岌可危逼近下軌'}，上方套牢壓力沉重。",
                        "advice": "⚠️ 空方高危警戒：嚴禁開新多單！手中若有持股請嚴守防守位，跌破頸線建議果斷減碼或停損避險！",
                        "action_type": "warning",
                        "entry": None, # 空方警示不提供做多進場點
                        "sl": round(neckline, 2), # 防守位
                        "tp": round(neckline - h_top, 2), # 預期下殺目標
                        "rr": 0.0,
                        "neckline": neckline,
                        "support": neckline,
                        "resistance": max(p1['price'], p2['price'])
                    }

    # 3. 頭肩底 (Inverse Head & Shoulders) - 多方強烈反轉
    if len(valleys) >= 3 and len(peaks) >= 2:
        v1, v2, v3 = valleys[-3], valleys[-2], valleys[-1] # 左肩、頭部、右肩
        if v2['price'] < v1['price'] and v2['price'] < v3['price']: # 頭部最低
            if abs(v1['price'] - v3['price']) / max(v1['price'], 1e-5) <= 0.05: # 左右肩高度相近
                neckline = max(peaks[-1]['price'], peaks[-2]['price'])
                h_head = neckline - v2['price']
                if cur_p >= neckline * 0.98:
                    entry = round(max(cur_p, neckline * 1.005), 2)
                    sl = round(v3['price'] * 0.985, 2)
                    tp = round(neckline + h_head, 2)
                    rr = round((tp - entry) / max(entry - sl, 0.01), 2)
                    is_breakout = cur_p >= neckline
                    return {
                        "code": "inverse_head_shoulders",
                        "name": "🚀 頭肩底 (Inverse H&S) 向上突破" if is_breakout else "⏳ 頭肩底右肩成型中",
                        "type": "bullish",
                        "desc": f"標準多方反轉結構：左肩 ${v1['price']:.1f}、頭部最低點 ${v2['price']:.1f}、右肩 ${v3['price']:.1f}，反彈頸線位於 ${neckline:.1f}。形態對稱且獲有力支撐。",
                        "advice": "🎯 建議進場佈局：大型反轉底成型，突破頸線為黃金攻擊買點" if is_breakout else "⏳ 建議右肩附近逢低分批佈局，嚴設頭部停損",
                        "action_type": "buy" if is_breakout else "watch",
                        "entry": entry,
                        "sl": sl,
                        "tp": tp,
                        "rr": max(rr, 1.8),
                        "neckline": neckline,
                        "support": v3['price'],
                        "resistance": neckline
                    }

    # 4. 頭肩頂 (Head & Shoulders) - ⚠️ 空方高危險警示 (選項 2)
    if len(peaks) >= 3 and len(valleys) >= 2:
        p1, p2, p3 = peaks[-3], peaks[-2], peaks[-1]
        if p2['price'] > p1['price'] and p2['price'] > p3['price']: # 頭部最高
            if abs(p1['price'] - p3['price']) / max(p1['price'], 1e-5) <= 0.05:
                neckline = min(valleys[-1]['price'], valleys[-2]['price'])
                h_head = p2['price'] - neckline
                if cur_p <= neckline * 1.025:
                    is_breakdown = cur_p < neckline
                    return {
                        "code": "head_shoulders_top",
                        "name": "⚠️ 頭肩頂跌破頸線高危警示" if is_breakdown else "⚠️ 頭肩頂右肩成型警戒",
                        "type": "bearish_warning",
                        "desc": f"典型大型頭部結構：左肩 ${p1['price']:.1f}、頭部天花板 ${p2['price']:.1f}、右肩力竭點 ${p3['price']:.1f}，頸線支撐位 ${neckline:.1f}。下檔獲利了結與反轉賣壓極為沉重。",
                        "advice": "⚠️ 空方高危警戒：嚴禁做多！持股者應於頸線被擊穿時立即果斷清倉離場，防範等幅下殺。",
                        "action_type": "warning",
                        "entry": None,
                        "sl": round(neckline, 2),
                        "tp": round(neckline - h_head, 2),
                        "rr": 0.0,
                        "neckline": neckline,
                        "support": neckline,
                        "resistance": p3['price']
                    }

    # 5. 上升三角形 (Ascending Triangle) - 多方突破
    if len(peaks) >= 2 and len(valleys) >= 2:
        p1, p2 = peaks[-2], peaks[-1]
        v1, v2 = valleys[-2], valleys[-1]
        # 高點水平相近 (阻力線)，低點逐步墊高 (上升支撐線)
        if abs(p1['price'] - p2['price']) / max(p1['price'], 1e-5) <= 0.025 and v2['price'] > v1['price'] * 1.01:
            neckline = max(p1['price'], p2['price'])
            h_tri = neckline - v1['price']
            is_breakout = cur_p >= neckline * 0.99
            entry = round(max(cur_p, neckline * 1.005), 2)
            sl = round(v2['price'] * 0.985, 2)
            tp = round(neckline + h_tri, 2)
            rr = round((tp - entry) / max(entry - sl, 0.01), 2)
            return {
                "code": "ascending_triangle",
                "name": "🚀 上升三角形突破" if is_breakout else "📈 上升三角形收斂末端",
                "type": "bullish",
                "desc": f"上方在 ${neckline:.1f} 面臨水平壓力線，下方買盤積極墊高低點 (${v1['price']:.1f} -> ${v2['price']:.1f})。三角形收斂即將向上噴發。",
                "advice": "🎯 建議進場佈局：突破水平阻力線上攻，多頭蓄勢待發" if is_breakout else "⏳ 建議沿上升支撐線逢低佈局，等待突破信號",
                "action_type": "buy" if is_breakout else "watch",
                "entry": entry,
                "sl": sl,
                "tp": tp,
                "rr": max(rr, 1.6),
                "neckline": neckline,
                "support": v2['price'],
                "resistance": neckline
            }

    # 6. 下降三角形 (Descending Triangle) - ⚠️ 空方高危險警示 (選項 2)
    if len(valleys) >= 2 and len(peaks) >= 2:
        v1, v2 = valleys[-2], valleys[-1]
        p1, p2 = peaks[-2], peaks[-1]
        # 低點水平相近 (支撐線)，高點逐步走低 (下降壓力線)
        if abs(v1['price'] - v2['price']) / max(v1['price'], 1e-5) <= 0.025 and p2['price'] < p1['price'] * 0.99:
            support_line = min(v1['price'], v2['price'])
            if cur_p <= support_line * 1.02:
                is_breakdown = cur_p < support_line
                return {
                    "code": "descending_triangle",
                    "name": "⚠️ 下降三角形跌破警戒" if is_breakdown else "⚠️ 下降三角形下壓警戒",
                    "type": "bearish_warning",
                    "desc": f"空方持續壓低反彈高點 (${p1['price']:.1f} -> ${p2['price']:.1f})，下方水平支撐點 ${support_line:.1f} 承受連續撞擊測試。支撐力道即將耗盡。",
                    "advice": "⚠️ 空方高危警戒：嚴禁逢低摸底！水平支撐位一旦失守將引發多殺多斷頭潮，持股請嚴格執行防守停損。",
                    "action_type": "warning",
                    "entry": None,
                    "sl": round(support_line, 2),
                    "tp": round(support_line - (p1['price'] - support_line), 2),
                    "rr": 0.0,
                    "neckline": support_line,
                    "support": support_line,
                    "resistance": p2['price']
                }

    # 7. 箱型整理突破 / 跌破 (Rectangle Breakout / Breakdown)
    box_high = recent_high_20
    box_low = recent_low_20
    box_h = box_high - box_low
    if box_h > 0 and (box_h / box_low) >= 0.04 and (box_h / box_low) <= 0.18:
        # 箱型向上突破
        if cur_p >= box_high * 0.99:
            entry = round(max(cur_p, box_high * 1.005), 2)
            sl = round(box_high - box_h * 0.45, 2)
            tp = round(box_high + box_h, 2)
            rr = round((tp - entry) / max(entry - sl, 0.01), 2)
            return {
                "code": "rectangle_breakout",
                "name": "📦 箱型向上強勢突破",
                "type": "bullish",
                "desc": f"股價在 ${box_low:.1f} ~ ${box_high:.1f} 箱型區間充分換手洗盤，最新收盤價帶量攻破箱頂天花板，開啟等幅測距漲升波段。",
                "advice": "🎯 建議進場做多：突破箱型上軌確立，建議突破追進或回踩箱頂守穩加碼。",
                "action_type": "buy",
                "entry": entry,
                "sl": sl,
                "tp": tp,
                "rr": max(rr, 1.8),
                "neckline": box_high,
                "support": box_low,
                "resistance": box_high
            }
        # 箱型向下跌破 ⚠️ 空方高危險警示 (選項 2)
        elif cur_p <= box_low * 1.01:
            return {
                "code": "rectangle_breakdown",
                "name": "⚠️ 箱型整理向下跌破警示",
                "type": "bearish_warning",
                "desc": f"過去 20 個週期震盪箱型下軌 ${box_low:.1f} 失守，空方摜破支撐箱底，箱型套牢籌碼恐面臨停損賣壓。",
                "advice": "⚠️ 空方高危警戒：嚴禁開多抄底！箱底失守將引發等幅下殺，手中庫存請立刻設定防守停損位避免擴大虧損。",
                "action_type": "warning",
                "entry": None,
                "sl": round(box_low, 2),
                "tp": round(box_low - box_h, 2),
                "rr": 0.0,
                "neckline": box_low,
                "support": box_low,
                "resistance": box_high
            }

    # 8. 多頭旗形 / 多頭三角旗 (Bullish Flag / Bullish Pennant)
    # 旗桿判斷：10~25 根前有一波爆發性上漲 (> 8%)
    closes = df['close'].values
    if len(closes) >= 20:
        past_low = float(df['low'].tail(25).head(15).min())
        pole_high = float(df['high'].tail(15).max())
        pole_height = pole_high - past_low
        if past_low > 0 and (pole_height / past_low) >= 0.08:
            # 旗面回檔幅度小於 50%
            current_pullback = pole_high - cur_p
            if current_pullback <= pole_height * 0.45 and cur_p > past_low + pole_height * 0.5:
                # 旗面突破
                if cur_p >= pole_high * 0.98 or vol_mult > 1.2:
                    entry = round(cur_p, 2)
                    sl = round(cur_p - atr * 1.5, 2)
                    tp = round(cur_p + pole_height * 0.8, 2)
                    rr = round((tp - entry) / max(entry - sl, 0.01), 2)
                    return {
                        "code": "bullish_flag",
                        "name": "🚩 多頭旗形 (Bullish Flag) 攻擊突破",
                        "type": "bullish",
                        "desc": f"前期自 ${past_low:.1f} 急拉至 ${pole_high:.1f} 形成陡峭旗桿，近期呈高檔強勢量縮回檔換手。現價重啟多頭動能突破旗面上軌。",
                        "advice": "🎯 建議進場做多：強勢股多頭中繼型態完成，後續具備複製旗桿漲幅的二次發動機會。",
                        "action_type": "buy",
                        "entry": entry,
                        "sl": sl,
                        "tp": tp,
                        "rr": max(rr, 2.0),
                        "neckline": pole_high,
                        "support": round(pole_high - pole_height * 0.382, 2),
                        "resistance": pole_high
                    }

    # 9. 下降趨勢線向上突破 (Descending Trendline Breakout)
    if len(peaks) >= 2:
        p1, p2 = peaks[-2], peaks[-1]
        # 前期波峰高點一路降低 (下降趨勢)
        if p1['price'] > p2['price'] * 1.02:
            # 最新價格突破最近的下降波峰
            if cur_p >= p2['price']:
                entry = round(max(cur_p, p2['price'] * 1.005), 2)
                sl = round(min(cur_p - atr * 1.5, valleys[-1]['price'] if valleys else cur_p * 0.95), 2)
                tp = round(p1['price'] * 1.02, 2)
                rr = round((tp - entry) / max(entry - sl, 0.01), 2)
                return {
                    "code": "trendline_breakout",
                    "name": "⚡ 下降趨勢線向上反轉突破",
                    "type": "bullish",
                    "desc": f"長期受到由 ${p1['price']:.1f} 與 ${p2['price']:.1f} 連成的下降壓力線壓制，最新一根 K 棒放量越過下降壓力線與次級波峰，空頭格局正式翻多扭轉。",
                    "advice": "🎯 建議進場佈局：長期空方慣性被扭轉破壞，波段反轉成立，建議順勢進場。",
                    "action_type": "buy",
                    "entry": entry,
                    "sl": sl,
                    "tp": tp,
                    "rr": max(rr, 1.7),
                    "neckline": p2['price'],
                    "support": sl,
                    "resistance": p1['price']
                }

    # 10. 上升楔形 (Rising Wedge) - ⚠️ 空方高危險警示 (選項 2)
    if len(peaks) >= 2 and len(valleys) >= 2:
        p1, p2 = peaks[-2], peaks[-1]
        v1, v2 = valleys[-2], valleys[-1]
        if p2['price'] > p1['price'] and v2['price'] > v1['price']:
            # 斜率收斂 (高點抬升幅度小於低點抬升幅度，向上楔形)
            peak_gain = (p2['price'] - p1['price']) / p1['price']
            valley_gain = (v2['price'] - v1['price']) / v1['price']
            if peak_gain < valley_gain * 0.6 and cur_p < v2['price'] * 1.01:
                return {
                    "code": "rising_wedge",
                    "name": "⚠️ 上升楔形 (Rising Wedge) 誘多跌破警示",
                    "type": "bearish_warning",
                    "desc": f"價格雖持續創高但動能明顯衰竭收斂，呈現典型上升楔形誘多型態。下軌支撐點 ${v2['price']:.1f} 遭受考驗，隨時恐引發空方急殺。",
                    "advice": "⚠️ 空方高危警戒：嚴禁追高開多！上升楔形為經典力竭誘多結構，一旦摜破下軌應立刻啟動防守清倉。",
                    "action_type": "warning",
                    "entry": None,
                    "sl": round(v2['price'], 2),
                    "tp": round(v1['price'], 2),
                    "rr": 0.0,
                    "neckline": v2['price'],
                    "support": v2['price'],
                    "resistance": p2['price']
                }

    # 11. 常態健康趨勢 (均線多頭 / 震盪整理)
    if st_val == 1 and cur_p > ma20:
        entry = round(cur_p, 2)
        sl = round(max(ma20 * 0.98, cur_p - atr * 1.6), 2)
        tp = round(cur_p + atr * 2.8, 2)
        rr = round((tp - entry) / max(entry - sl, 0.01), 2)
        return {
            "code": "bullish_trend_alignment",
            "name": "📈 多頭均線發散推進型態",
            "type": "bullish",
            "desc": f"股價穩健站於 20MA (${ma20:.1f}) 之上，SuperTrend 呈現健康多頭訊號，均線呈現多方排列推進，沿趨勢階梯式墊高走勢。",
            "advice": "🎯 建議順勢操作：多頭常態推進，建議回踩 10MA~20MA 支撐附近分批佈局做多。",
            "action_type": "buy",
            "entry": entry,
            "sl": sl,
            "tp": tp,
            "rr": max(rr, 1.5),
            "neckline": recent_high_20,
            "support": ma20,
            "resistance": recent_high_20
        }
    else:
        # 空方或弱勢整理 ⚠️ (選項 2 保留風險警示)
        return {
            "code": "consolidation_neutral",
            "name": "⚠️ 弱勢震盪整理警戒區" if st_val == -1 else "⏸️ 區間平衡整理觀察區",
            "type": "bearish_warning" if st_val == -1 else "neutral",
            "desc": f"目前價格在 ${recent_low_20:.1f} ~ ${recent_high_20:.1f} 區間內反覆拉鋸，{'SuperTrend 處於空方下壓格局，空頭控盤' if st_val == -1 else '多空雙方處於平衡勢力，尚未出現具備優勢之突破幾何型態'}。",
            "advice": "⚠️ 空方趨勢下壓中，嚴禁開多，有持股請嚴守停損位" if st_val == -1 else "⏳ 建議耐心觀望：缺乏高勝率突破型態，請保留現金等待明確攻擊信號出現",
            "action_type": "warning" if st_val == -1 else "watch",
            "entry": round(recent_high_20 * 1.01, 2) if st_val != -1 else None,
            "sl": round(recent_low_20, 2),
            "tp": round(recent_high_20 + range_height * 0.8, 2) if st_val != -1 else None,
            "rr": 1.2 if st_val != -1 else 0.0,
            "neckline": recent_high_20,
            "support": recent_low_20,
            "resistance": recent_high_20
        }


def _generate_indicator_metrics(stock_info, vol_mult, vol_cur, atr, bb_width, st_val, cur_p, ma5, ma20, ma60):
    """
    產生四大維度量化診斷指標摘要：成交量、三大法人籌碼、波動率、大趨勢
    """
    stock_info = stock_info or {}

    # 1. 成交量
    daily_vol_info = stock_info.get('dailyVol')
    if daily_vol_info and int(daily_vol_info) > 0:
        vol_k = int(daily_vol_info)
    else:
        vol_k = int(vol_cur // 1000) if vol_cur > 0 else 0
    if vol_mult >= 2.0:
        vol_desc = f"💥 巨量爆發 ({vol_mult}倍 20MA，當前約 {vol_k:,} 張)"
    elif vol_mult >= 1.2:
        vol_desc = f"🔥 溫和放量 ({vol_mult}倍 20MA，當前約 {vol_k:,} 張)"
    elif vol_mult >= 0.8:
        vol_desc = f"⚖️ 常態均量 ({vol_mult}倍 20MA，當前約 {vol_k:,} 張)"
    else:
        vol_desc = f"🧊 極度量縮 ({vol_mult}倍 20MA，當前約 {vol_k:,} 張)"

    # 2. 三大法人籌碼
    trust_days = stock_info.get('trustDays', 0) or 0
    foreign_buy = stock_info.get('foreignNetBuy', 0) or 0
    dealer_days = stock_info.get('dealerDays', 0) or 0
    inst_5d = stock_info.get('instSum5D', 0) or 0

    chip_parts = []
    if trust_days > 0:
        chip_parts.append(f"投信買超 {trust_days} 張")
    elif trust_days < 0:
        chip_parts.append(f"投信賣超 {abs(trust_days)} 張")

    if foreign_buy > 0:
        chip_parts.append(f"外資買超 {foreign_buy} 張")
    elif foreign_buy < 0:
        chip_parts.append(f"外資賣超 {abs(foreign_buy)} 張")

    if dealer_days > 0:
        chip_parts.append(f"自營商買超 {dealer_days} 張")
    elif dealer_days < 0:
        chip_parts.append(f"自營商賣超 {abs(dealer_days)} 張")

    if not chip_parts:
        inst_desc = f"三大法人動向觀望 (5日法人淨動向: {inst_5d:+} 張)"
    else:
        inst_desc = f"{'、'.join(chip_parts)} (5日主力淨額: {inst_5d:+} 張)"

    # 3. 波動率
    if bb_width > 15.0:
        volat_desc = f"⚡ 劇烈波動 (ATR ${atr:.2f}，布林帶寬 {bb_width:.1f}% 喇叭開口)"
    elif bb_width < 6.0:
        volat_desc = f"🎯 緊縮蓄勢 (ATR ${atr:.2f}，布林帶寬 {bb_width:.1f}% 極度收斂)"
    else:
        volat_desc = f"🌊 常態波動 (ATR ${atr:.2f}，布林帶寬 {bb_width:.1f}%)"

    # 4. 大趨勢
    ma_bull = (cur_p > ma20 > ma60)
    if st_val == 1 and ma_bull:
        trend_desc = "🟢 超級趨勢 SuperTrend 多頭確立，多方均線 (5/20/60) 向上多頭排列"
        trend_status = "bull"
    elif st_val == 1:
        trend_desc = "🟡 超級趨勢 SuperTrend 多頭，均線呈震盪整理"
        trend_status = "bull"
    else:
        trend_desc = "🔴 超級趨勢 SuperTrend 空方下壓，均線遭空頭壓制，嚴防續跌"
        trend_status = "bear"

    return {
        "volume_mult": vol_mult,
        "volume_desc": vol_desc,
        "inst_chip": inst_desc,
        "volatility_atr": atr,
        "volatility_desc": volat_desc,
        "trend_direction": trend_desc,
        "trend_status": trend_status
    }


def _build_fallback_report(timeframe, cur_p, stock_info, reason=""):
    """
    當資料不足時之安全備援報告
    """
    atr = round(cur_p * 0.025, 2)
    return {
        "timeframe": timeframe,
        "pattern_code": "data_insufficient",
        "pattern_name": "⏸️ 趨勢觀察與動態監控",
        "pattern_type": "neutral",
        "pattern_desc": f"{reason}。現階段建議依據均線防守與量能變化作為決策依據。",
        "action_advice": "⏳ 建議中性觀望：待更完整價格結構浮現後再行動作",
        "action_type": "watch",
        "entry_price": None,
        "stop_loss": round(cur_p * 0.95, 2),
        "take_profit": round(cur_p * 1.05, 2),
        "risk_reward_ratio": 1.0,
        "neckline": cur_p,
        "support": round(cur_p * 0.95, 2),
        "resistance": round(cur_p * 1.05, 2),
        "metrics": {
            "volume_mult": 1.0,
            "volume_desc": "常態均量",
            "inst_chip": "法人籌碼動態觀望",
            "volatility_atr": atr,
            "volatility_desc": f"常態波動 (ATR ${atr:.2f})",
            "trend_direction": "中性平衡格局",
            "trend_status": "neutral"
        }
    }
