# 荳荳 AI 多因子量化交易系統 — 完整策略文件 V1

> **版本**: V1.0 (2026-07-24)
> **適用市場**: 加密貨幣（已完成）/ 台股（規劃中）
> **主時框**: 4H（加密貨幣）/ 日線（台股建議）
> **Pine Script 版本**: v6

---

## 目錄

1. [策略核心架構](#1-策略核心架構)
2. [趨勢過濾層 — SuperTrend](#2-趨勢過濾層--supertrend)
3. [多因子評分系統（滿分 100 分）](#3-多因子評分系統滿分-100-分)
4. [進出場訊號邏輯](#4-進出場訊號邏輯)
5. [風控管理](#5-風控管理)
6. [操作標籤說明](#6-操作標籤說明)
7. [TradingView 指標設定參數](#7-tradingview-指標設定參數)
8. [回測結果（加密貨幣）](#8-回測結果加密貨幣)
9. [Pine Script v6 完整程式碼（指標版）](#9-pine-script-v6-完整程式碼指標版)
10. [Pine Script 技術筆記](#10-pine-script-技術筆記)
11. [台股整合方向規劃](#11-台股整合方向規劃)

---

## 1. 策略核心架構

```
┌─────────────────────────────────────────────┐
│           SuperTrend 趨勢硬過濾              │
│   Up-trend → 只允許做多    (不計分)          │
│   Down-trend → 只允許做空  (不計分)          │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│         多因子微結構評分（滿分 100 分）       │
│                                             │
│   ① ADX 趨勢強度     → 25 分               │
│   ② 成交量爆量       → 25 分               │
│   ③ OI 安全度        → 25 分               │
│   ④ S/R 反轉 K 棒    → 25 分               │
│                                             │
│   總分 ≥ 60 分 → 觸發進場訊號               │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│              風控管理                        │
│   ATR × 2.5 防禦止損                        │
│   SuperTrend 反轉 → 強制平倉               │
└─────────────────────────────────────────────┘
```

**設計哲學**：趨勢決定方向（不計分），微結構決定時機（計分），風控決定存活。

---

## 2. 趨勢過濾層 — SuperTrend

| 參數 | 預設值 | 說明 |
|------|--------|------|
| Period | 10 | SuperTrend 計算週期 |
| Multiplier | 3.0 | ATR 倍數（越大越寬鬆） |

### 運作邏輯

- **`st_dir == -1`（Up-trend）**：SuperTrend 線在 K 線下方，綠色，**只允許做多**
- **`st_dir == 1`（Down-trend）**：SuperTrend 線在 K 線上方，紅色，**只允許做空**
- SuperTrend 翻轉（方向改變）是進場/出場的必要條件之一

> ⚠️ **趨勢不計分**，它只是硬性的方向過濾器。即使所有評分維度都滿分（100 分），如果趨勢方向不對，也不會觸發訊號。

---

## 3. 多因子評分系統（滿分 100 分）

### ① ADX 趨勢強度（25 分）

| 條件 | 分數 |
|------|------|
| ADX > 20 | **25 分** |
| ADX ≤ 20 | 0 分 |

- **計算方式**：`ta.dmi(14, 14)` 取 ADX 值
- **意義**：ADX > 20 代表市場處於明確趨勢中（非盤整），進場勝率更高

### ② 成交量爆量（25 分）

| 條件 | 分數 |
|------|------|
| 當前成交量 > 20 日均量 × 1.5 | **25 分** |
| 否則 | 0 分 |

- **計算方式**：`volume > ta.sma(volume, 20) * 1.5`
- **意義**：爆量代表市場參與者活躍度高，趨勢啟動的動能充足

### ③ OI 安全度 / 量能確認（25 分）

| 條件 | 分數 |
|------|------|
| 當前成交量 > 20 日均量 | **25 分** |
| 否則 | 0 分 |

- **計算方式**：`volume > ta.sma(volume, 20)`
- **意義**：加密貨幣版中等效於「未平倉合約安全度」的代理指標。成交量持續高於均值代表市場活躍度健康，極端爆倉風險較低
- **備註**：若有 Coinglass API 可取得真實 OI 數據，可替換為真實 OI 安全度判斷

### ④ 支撐阻力反轉 K 棒（25 分）

| 條件 | 分數 |
|------|------|
| 吞噬 K 棒 + 落在支撐/阻力區 | **25 分** |
| 僅吞噬 K 棒（未落在 S/R 區） | 15 分 |
| 無吞噬 K 棒 | 0 分 |

- **吞噬 K 棒定義**：
  - 多頭吞噬 (Bullish Engulfing)：前一根收黑，當前收紅，且完全包覆前一根實體
  - 空頭吞噬 (Bearish Engulfing)：前一根收紅，當前收黑，且完全包覆前一根實體
- **支撐/阻力判定**：
  - 支撐：`ta.lowest(low, 20)` 的 1% 範圍內
  - 阻力：`ta.highest(high, 20)` 的 1% 範圍內
- **白色反轉 K 線**：所有反轉吞噬 K 棒會被塗成**純白色** (`barcolor`)，方便視覺辨識

### 評分門檻

| 總分 | 結果 |
|------|------|
| **≥ 60 分** | 觸發進場訊號（預設門檻） |
| < 60 分 | 不觸發，繼續等待 |

> 門檻可在指標設定中調整（建議範圍 60-75 分）

---

## 4. 進出場訊號邏輯

### 做多進場條件（全部必須同時成立）

1. ✅ SuperTrend **翻多**（從 Down-trend 轉為 Up-trend）
2. ✅ 當前處於 **Up-trend**
3. ✅ 多頭總分 **≥ 60 分**
4. ✅ 交易方向設定允許做多

### 做空進場條件（全部必須同時成立）

1. ✅ SuperTrend **翻空**（從 Up-trend 轉為 Down-trend）
2. ✅ 當前處於 **Down-trend**
3. ✅ 空頭總分 **≥ 60 分**
4. ✅ 交易方向設定允許做空

### 加倉條件

- **加倉多**：已持有多頭部位 + Up-trend + 出現多頭吞噬 K 棒 + 落在支撐區
- **加倉空**：已持有空頭部位 + Down-trend + 出現空頭吞噬 K 棒 + 落在阻力區

### 平倉條件

- **賣出多**：持有多頭部位時，SuperTrend 翻空 → 強制平倉
- **賣出空**：持有空頭部位時，SuperTrend 翻多 → 強制平倉
- **止損**：ATR × 2.5 防禦止損觸發（策略版使用）

---

## 5. 風控管理

| 風控機制 | 設定 |
|---------|------|
| 防禦止損 | ATR(14) × 2.5（預設） |
| 強制平倉 | SuperTrend 反轉方向時無條件平倉 |
| 手續費 | 0.1%（單向） |
| 滑點 | 0.05%（單向） |
| 單趟摩擦 | 0.3%（來回） |
| 加倉上限 | pyramiding = 1（最多加倉 1 次） |

---

## 6. 操作標籤說明

| 標籤 | 顏色 | 位置 | 意義 |
|------|------|------|------|
| **做多** | 🟢 綠色 | K 棒下方 | 多頭進場訊號 |
| **做空** | 🔴 紅色 | K 棒上方 | 空頭進場訊號 |
| **加倉多** | 🟣 紫色 | K 棒下方 | 多頭加碼訊號 |
| **加倉空** | 🟣 紫色 | K 棒上方 | 空頭加碼訊號 |
| **賣出多** | 🔵 藍色 | K 棒上方 | 多頭平倉 |
| **賣出空** | 🔵 藍色 | K 棒下方 | 空頭平倉 |
| **白色 K 棒** | ⚪ 白色 | K 棒本體 | 反轉吞噬 K 棒標記 |

---

## 7. TradingView 指標設定參數

| 群組 | 參數 | 預設值 | 說明 |
|------|------|--------|------|
| 交易方向 | 交易方向 | 做多+做空 | 下拉選單：做多 / 做空 / 做多+做空 |
| 開單門檻評分 | 最低總分門檻 | 60 | 建議 60-75 分 |
| 趨勢過濾 | SuperTrend Period | 10 | — |
| 趨勢過濾 | SuperTrend Multiplier | 3.0 | — |
| 評分維度 | ADX 週期 | 14 | — |
| 評分維度 | ADX 強度門檻 | 20.0 | 大於此值給 25 分 |
| 風控管理 | ATR 防禦止損倍數 | 2.5 | — |

---

## 8. 回測結果（加密貨幣）

### 回測參數

| 項目 | 設定 |
|------|------|
| 回測窗口 | 2023-01-01 00:00 UTC ~ 2026-07-22 04:00 UTC |
| 回測天數 | 1,298 天（3.55 年） |
| 主時框 | 4H |
| 初始資金 | $50,000 |
| 手續費 | 0.1% + 0.05% 滑點 |
| 評分門檻 | 60 分 |

### 個別幣種結果

| 幣種 | 總報酬 | Sharpe Ratio | 最大回撤 | 勝率 | 交易次數 |
|------|--------|-------------|---------|------|---------|
| BTC/USDT | +39.53% | 2.34 | — | 50.00% | 78 |
| ETH/USDT | +30.18% | 1.62 | — | 45.76% | 59 |
| SOL/USDT | +76.33% | 2.26 | — | 44.44% | 63 |

### 投資組合結果（BTC + ETH + SOL 等權重）

| 指標 | 數值 |
|------|------|
| **總報酬** | **+48.68%** |
| **Sharpe Ratio** | **2.07** |
| **最大回撤 (MDD)** | **-10.57%** |
| **勝率** | **46.74%** |
| **Profit Factor** | **2.14** |
| **總交易次數** | **200** |

---

## 9. Pine Script v6 完整程式碼（指標版）

```pine
//@version=6
indicator("Crypto 4H SuperTrend Master V1 (繁體中文標籤版)", overlay=true, max_labels_count=500)

// ==========================================
// 1. 使用者參數設定
// ==========================================
trade_dir       = input.string("做多+做空", title="交易方向", options=["做多", "做空", "做多+做空"], group="交易方向")
min_score_input = input.int(60, title="最低總分門檻 (建議 60-75 分)", group="開單門檻評分")
st_period       = input.int(10, title="SuperTrend Period", group="趨勢過濾")
st_multiplier   = input.float(3.0, title="SuperTrend Multiplier", step=0.1, group="趨勢過濾")
adx_len         = input.int(14, title="ADX 週期", group="評分維度")
adx_thresh      = input.float(20.0, title="ADX 強度門檻 (大於此值給 25 分)", group="評分維度")
atr_sl_mult     = input.float(2.5, title="ATR 防禦止損倍數 (R)", group="風控管理")

// 方向過濾布林值
allow_long  = (trade_dir == "做多" or trade_dir == "做多+做空")
allow_short = (trade_dir == "做空" or trade_dir == "做多+做空")

// ==========================================
// 2. 指標與打分計算 (滿分 100 分)
// ==========================================
[st_val, st_dir] = ta.supertrend(st_multiplier, st_period)
is_uptrend   = (st_dir == -1)
is_downtrend = (st_dir == 1)

[_, _, adx_val] = ta.dmi(adx_len, adx_len)
f_adx = (adx_val > adx_thresh) ? 25 : 0

vol_ma    = ta.sma(volume, 20)
vol_spike = volume > (vol_ma * 1.5)
f_vol     = vol_spike ? 25 : 0
f_oi_safe = (volume > vol_ma) ? 25 : 0

prev_open  = open[1]
prev_close = close[1]
is_bull_engulfing = (prev_close < prev_open) and (close > open) and (open <= prev_close) and (close >= prev_open)
is_bear_engulfing = (prev_close > prev_open) and (close < open) and (open >= prev_close) and (close <= prev_open)
is_reversal_k = is_bull_engulfing or is_bear_engulfing

sr_support    = ta.lowest(low, 20)
sr_resistance = ta.highest(high, 20)
near_support    = (low <= sr_support * 1.01)
near_resistance = (high >= sr_resistance * 0.99)

f_sr_long  = (is_bull_engulfing and near_support) ? 25 : (is_bull_engulfing ? 15 : 0)
f_sr_short = (is_bear_engulfing and near_resistance) ? 25 : (is_bear_engulfing ? 15 : 0)

total_long_score  = f_adx + f_vol + f_oi_safe + f_sr_long
total_short_score = f_adx + f_vol + f_oi_safe + f_sr_short

// ==========================================
// 3. 進出場訊號邏輯 (依方向過濾)
// ==========================================
st_turn_bull = (st_dir == -1) and (st_dir[1] == 1)
st_turn_bear = (st_dir == 1) and (st_dir[1] == -1)

long_condition  = allow_long  and st_turn_bull and is_uptrend   and (total_long_score  >= min_score_input)
short_condition = allow_short and st_turn_bear and is_downtrend and (total_short_score >= min_score_input)

var int in_position = 0

if long_condition
    in_position := 1
if short_condition
    in_position := -1

add_long_condition  = allow_long  and is_uptrend   and (in_position ==  1) and is_bull_engulfing and near_support    and not long_condition
add_short_condition = allow_short and is_downtrend and (in_position == -1) and is_bear_engulfing and near_resistance and not short_condition

close_long_condition  = st_turn_bear and (in_position ==  1)
close_short_condition = st_turn_bull and (in_position == -1)

if close_long_condition or close_short_condition
    in_position := 0

// ==========================================
// 4. 視覺化 ── label.new() 零 Y 軸干擾標籤
// ==========================================
barcolor(is_reversal_k ? color.white : na, title="白色反轉 K 線")

plot(st_val,
     color     = is_uptrend ? color.green : color.red,
     linewidth = 2,
     title     = "SuperTrend 軌道",
     display   = display.all - display.price_scale)

if long_condition
    label.new(bar_index, na, "做多", yloc=yloc.belowbar, style=label.style_label_up, color=color.green, textcolor=color.white, size=size.small)

if short_condition
    label.new(bar_index, na, "做空", yloc=yloc.abovebar, style=label.style_label_down, color=color.red, textcolor=color.white, size=size.small)

if add_long_condition
    label.new(bar_index, na, "加倉多", yloc=yloc.belowbar, style=label.style_label_up, color=color.purple, textcolor=color.white, size=size.small)

if add_short_condition
    label.new(bar_index, na, "加倉空", yloc=yloc.abovebar, style=label.style_label_down, color=color.purple, textcolor=color.white, size=size.small)

if close_long_condition
    label.new(bar_index, na, "賣出多", yloc=yloc.abovebar, style=label.style_label_down, color=color.blue, textcolor=color.white, size=size.small)

if close_short_condition
    label.new(bar_index, na, "賣出空", yloc=yloc.belowbar, style=label.style_label_up, color=color.blue, textcolor=color.white, size=size.small)
```

---

## 10. Pine Script 技術筆記

### 已知問題與解決方案

| 問題 | 根因 | 解決方案 |
|------|------|---------|
| Y 軸被撐大到離譜範圍 | `plotshape(bool)` 的 `false` 回傳 `0` 污染自動縮放 | 改用 `label.new()` + `yloc=yloc.belowbar/abovebar`，完全不影響 Y 軸 |
| 標籤印出程式碼文字 | `label.new()` 搭配複雜字串串接 `\n` + `str.tostring()` 觸發渲染 Bug | 只用單一簡短文字（如 `"做多"`），不串接動態值 |
| SuperTrend 線撐大 Y 軸 | `plot(st_val)` 的歷史高低點被納入刻度計算 | 加上 `display=display.all - display.price_scale` |
| 切換時框後指標對不上 | 指標被 TradingView 分配到獨立刻度 | 移除舊指標後重新加入；右鍵 Y 軸 → 確認共用主刻度 |

### 回測防雷清單

| 陷阱 | 防範措施 |
|------|---------|
| 未來函數偷看 (Lookahead Bias) | 日線指標一律 `.shift(1)` 延遲一期 |
| 下一根 K 棒開盤執行 | 所有交易在 `Open[t+1]` 執行，非 `Close[t]` |
| ATR 平滑方式不一致 | 統一使用 Wilder's Smoothing (RMA) |
| 手續費摩擦未計入 | 0.1% 手續費 + 0.05% 滑點，來回 0.3% |

---

## 11. 台股整合方向規劃

### 加密貨幣 vs 台股：等效指標對照

| 加密貨幣指標 | 台股等效指標 | 等效原因 |
|------------|-----------|---------|
| **爆倉量** (Liquidation) | **融資維持率 + 融資餘額變化** | 融資維持率跌破 130% 觸發斷頭賣壓 = 散戶強制平倉 |
| **未平倉合約 (OI)** | **期貨三大法人未平倉 + 選擇權 P/C Ratio** | 外資台指期淨多/淨空 = 大戶方向 |
| **熱力圖 (Heatmap)** | **集保庫存分布 (TDCC)** | 各持股級距股東人數變化 = 籌碼集中/分散區間 |
| **資金費率 (Funding Rate)** | **借券賣出餘額** | 借券放空成本 = 看空情緒 |

### 台股版四維度評分設計

| 維度 | 條件 | 分數 | 資料來源 |
|------|------|------|---------|
| ① ADX 趨勢強度 | ADX > 20 | **25 分** | TradingView 內建 |
| ② 三大法人買賣超同向 | 外資+投信同向買/賣超 | **25 分** | 證交所每日公布 |
| ③ 融資安全度 | 融資維持率 > 150% | **25 分** | 證交所每日公布 |
| ④ 集保大戶增加 + 反轉 K 棒 | 大戶（1000張以上）持股比例上升 + 吞噬 K 棒 | **25 分** | TDCC 每週公布 |

### 台股版關鍵差異

| 項目 | 加密貨幣版 | 台股版建議 |
|------|----------|----------|
| 主時框 | 4H | **日線 (1D)** |
| 交易時間 | 24/7 | 09:00-13:30（僅平日） |
| 做空限制 | 無限制 | 需融券/期貨，平盤以下不可放空 |
| 數據更新頻率 | 即時 | 三大法人 T+1 / 集保 T+7 |
| 建議交易方向 | 做多+做空 | **以做多為主**（台股做空限制多） |
| SuperTrend 參數 | (10, 3.0) | **(10, 2.5)** 建議略緊（台股波動較小） |
| 評分門檻 | 60 分 | **65 分**（台股流動性較低，需更嚴格篩選） |

### 台股版數據取得方式

| 數據 | API / 來源 | 更新頻率 |
|------|-----------|---------|
| 三大法人買賣超 | 證交所 OpenData API / FinMind | 每日 16:00 後 |
| 融資融券餘額 | 證交所 / 櫃買中心 | 每日 |
| 融資維持率 | 各券商 API（需計算） | 每日 |
| 集保庫存分布 | TDCC OpenData | 每週五 |
| 借券賣出餘額 | 證交所 / FinMind | 每日 |
| 選擇權 P/C Ratio | 期交所 | 每日 |
| 台指期大額交易人未平倉 | 期交所 | 每日 |

---

## 版本歷程

| 版本 | 日期 | 變更內容 |
|------|------|---------|
| V1.0 | 2026-07-24 | 初版：完整策略架構、加密貨幣回測結果、台股整合規劃 |

---

> 📁 **檔案位置**: `C:\GoogleAntigravity\2026Trading1\version\`
> 🔗 **加密貨幣版原始碼**: `C:\GoogleAntigravity\2026Crypto\version7_user_custom_indicator.pine`
> 🔗 **加密貨幣版 V1 存檔**: `C:\GoogleAntigravity\2026Crypto\version\version1\`
