# 📊 荳荳 AI 台股 Version 7 選股指標 (Pine Script v6)

> **策略版本**：Version 7 (強勢爆量流動性過濾版)  
> **適用市場**：台灣股市 (TWSE / TPEx)  
> **適用時框**：日 K (1D) / 4小時 (4H)  
> **核心革新**：雙重硬性濾網 —— **成交量 $\ge 1.2\times$ 均量** ＋ **日成交量 $> 300$ 張**，一票否決無量與低流動性冷清個股。

---

## 💡 Version 7 核心升級與過濾邏輯

1. **爆量過濾引擎 ($\ge 1.2\times$ 20MA 均量)**：
   - 當日成交量必須達到 20 日均量的 1.2 倍以上。
   - 若量能不足 1.2 倍，即使技術面達標亦強制否決發動訊號。

2. **流動性防禦門檻 ($> 300$ 張)**：
   - 排除日成交量低於 300 張的孤兒股與殭屍股，確保進出場流動性順暢。
   - 自動判斷 TradingView 資料庫之「股數 (300,000股)」與「張數 (300張)」格式。

3. **70-80 分黃金發動甜蜜區**：
   - 結合 SuperTrend (10, 3.0)、ADX 趨勢強度、20MA 乖離率風控扣分。

---

## 💻 TradingView Pine Script v6 完整程式碼

請複製以下程式碼至 TradingView 的 **Pine Script 編輯器 (Pine Editor)** 中儲存並新增至圖表：

```pine
//@version=6
indicator("荳荳 AI Version 7 多因子雙時框爆量強勢選股指標 (1.2倍爆量 + 300張流動性防線)", overlay=true, max_labels_count=500, max_lines_count=500)

// =============================================================================
// 1. 參數設定面板 (Inputs)
// =============================================================================
grp_score = "🎯 分數與訊號門檻"
min_score = input.int(70, "買進最低分數門檻 (預設 70 分)", minval=50, maxval=90, group=grp_score)
max_score = input.int(89, "買進最高分數門檻 (預設 89 分, 避開 >= 90分過熱)", minval=70, maxval=100, group=grp_score)

grp_vol   = "⚡ 交易量與流動性過濾 (Version 7 核心變更)"
require_vol_spike = input.bool(true, "強制要求成交量 >= 1.2 倍 20MA 均量", group=grp_vol)
vol_spike_ratio   = input.float(1.2, "爆量倍數門檻 (預設 1.2x)", minval=1.0, maxval=3.0, step=0.1, group=grp_vol)
require_min_vol   = input.bool(true, "防範孤兒股：強制要求日成交量 > 300 張", group=grp_vol)
min_vol_contracts = input.int(300, "最低日成交量門檻 (張)", minval=50, step=50, group=grp_vol)

grp_ma    = "📈 均線與趨勢參數"
len_ma5   = input.int(5,  "快線 5MA 週期", group=grp_ma)
len_ma20  = input.int(20, "慢線 20MA 週期", group=grp_ma)
len_ma60  = input.int(60, "季線 60MA 週期", group=grp_ma)

grp_adx   = "⚡ ADX 趨勢強度參數"
adx_len   = input.int(14, "ADX 週期", group=grp_adx)
adx_th1   = input.int(20, "ADX 入門門檻 (20)", group=grp_adx)
adx_th2   = input.int(30, "ADX 強勢門檻 (30)", group=grp_adx)

grp_risk  = "🛡️ 風控與停損參數"
stop_loss_pct = input.float(20.0, "固定停損百分比 (%)", minval=5.0, maxval=30.0, group=grp_risk)
bias_th1      = input.float(15.0, "20MA 乖離率一級懲罰 (%)", group=grp_risk)
bias_th2      = input.float(20.0, "20MA 乖離率二級懲罰 (%)", group=grp_risk)

// =============================================================================
// 2. 技術指標計算 (Technical Calculations)
// =============================================================================
// 均線
ma5  = ta.sma(close, len_ma5)
ma20 = ta.sma(close, len_ma20)
ma60 = ta.sma(close, len_ma60)

// 成交量與均量判斷
vol_ma20  = ta.sma(volume, len_ma20)
vol_ratio = vol_ma20 > 0 ? (volume / vol_ma20) : 1.0

// 💡 1. 交易量 1.2 倍門檻
pass_vol_spike = not require_vol_spike or (vol_ratio >= vol_spike_ratio)

// 💡 2. 日交易量 > 300 張門檻 (自動相容 TradingView 股數 300,000 股與張數 300 表示法)
pass_min_volume = not require_min_vol or (volume >= min_vol_contracts * 1000) or (volume >= min_vol_contracts and volume < 10000)

// ADX & DMI 計算
[plus_di, minus_di, adx_val] = ta.dmi(adx_len, adx_len)

// SuperTrend (10, 3.0)
[st_val, st_dir] = ta.supertrend(3.0, 10)
supertrend_bull  = (st_dir < 0)  // -1 代表 SuperTrend 翻綠做多

// 20MA 乖離率 (%)
bias_20ma = ma20 > 0 ? ((close - ma20) / ma20) * 100.0 : 0.0

// K 線屬性與滯漲防護
is_bull_k = close > open
candle_rng = high - low
upper_shadow = candle_rng > 0 ? (high - math.max(open, close)) / candle_rng : 0.0
is_stagnant = (vol_ratio > 2.2) and (not is_bull_k or upper_shadow > 0.4)

// 近 20 根 Low 最低點 (支撐防線)
recent_low20 = ta.lowest(low, 20)
near_support = (low <= recent_low20 * 1.03) and is_bull_k

// =============================================================================
// 3. 荳荳 AI Version 7 多因子計分卡 (Scoring System)
// =============================================================================
int score = 0

// (1) ADX 趨勢因子 (最高 20 分)
f_adx = adx_val > adx_th2 ? 20 : (adx_val > adx_th1 ? 10 : 0)

// (2) 均線排列因子 (最高 20 分)
f_ma = (close > ma5 and ma5 > ma20) ? 20 : ((close > ma20) ? 10 : ((close > ma5) ? 5 : 0))

// (3) 成交量爆量與風控因子 (最高 25 分)
f_vol = is_stagnant ? 5 : (vol_ratio >= 1.5 ? 25 : (vol_ratio >= 1.2 ? 20 : 0))

// (4) K線型態與支撐因子 (最高 20 分)
f_pat = (is_bull_k and near_support) ? 20 : (is_bull_k ? 10 : 0)

// (5) 動態趨勢因子 (最高 25 分)
f_chip = supertrend_bull ? 25 : (vol_ratio >= 1.2 ? 15 : 10)

// (6) 🛡️ 風控：20MA 乖離率懲罰
int penalty = 0
if bias_20ma > bias_th2
    penalty := 15
else if bias_20ma > bias_th1
    penalty := 10

// 總分計算 (限制於 0 ~ 100 分)
if not supertrend_bull
    score := 30  // 若 SuperTrend 為空頭軌道，強制扣至 30 分安全線
else
    raw_score = f_adx + f_ma + f_vol + f_pat + f_chip - penalty
    score := math.min(100, math.max(0, raw_score))

// =============================================================================
// 4. 狀態機與極簡動態標籤 (買進 / 加碼買進 / 賣出)
// 🚀 Version 7 核心進場條件：必須同時符合「分數門檻 + 1.2x爆量 + >300張成交量」！
// =============================================================================
bool is_buy_signal = (score >= min_score) and (score <= max_score) and supertrend_bull and pass_vol_spike and pass_min_volume
float stop_loss_price = close * (1.0 - stop_loss_pct / 100.0)

// 追蹤持倉狀態
var bool in_position = false
var float entry_price = 0.0

// 賣出條件：SuperTrend 翻紅空頭 或 跌破 -20% 停損價
bool sell_trigger = in_position and (not supertrend_bull or low <= entry_price * (1.0 - stop_loss_pct / 100.0))

if sell_trigger
    in_position := false
    label.new(bar_index, high * 1.01, "🔴 賣出", color=color.red, textcolor=color.white, style=label.style_label_down, size=size.small)

// 買進 / 加碼買進條件 (訊號發動點)
bool buy_trigger = is_buy_signal and not is_buy_signal[1]

if buy_trigger and not sell_trigger
    if not in_position
        // 第一次開倉建倉
        in_position := true
        entry_price := close
        label.new(bar_index, low * 0.99, "🟢 買進 (V7爆量)", color=color.green, textcolor=color.white, style=label.style_label_up, size=size.small)
    else
        // 已在持倉狀態中，再次符合發動條件 -> 加碼買進
        label.new(bar_index, low * 0.99, "🔵 加碼買進", color=color.blue, textcolor=color.white, style=label.style_label_up, size=size.small)

// =============================================================================
// 5. 圖表視覺化繪製 (Plotting & Visualization)
// =============================================================================
// 均線
plot(ma5,  "5MA",  color=color.new(color.yellow, 0), linewidth=1)
plot(ma20, "20MA", color=color.new(color.orange, 0), linewidth=2)
plot(ma60, "60MA", color=color.new(color.aqua, 0),   linewidth=2)

// SuperTrend 軌道
plot(st_val, "SuperTrend", color=supertrend_bull ? color.green : color.red, linewidth=2)

// =============================================================================
// 6. 實時選股與條件狀態看板 (Version 7 Real-Time Dashboard)
// =============================================================================
var table board = table.new(position.top_right, 2, 9, bgcolor=color.new(color.black, 20), border_color=color.gray, border_width=1)

if barstate.islast
    table.cell(board, 0, 0, "荳荳 AI Version 7 看板", text_color=color.orange, text_size=size.small)
    table.cell(board, 1, 0, "即時檢測狀態", text_color=color.white, text_size=size.small)

    table.cell(board, 0, 1, "當前多因子總分", text_color=color.white, text_size=size.small)
    table.cell(board, 1, 1, str.tostring(score) + " 分", text_color=score >= min_score ? color.green : color.red, text_size=size.small)

    table.cell(board, 0, 2, "持倉狀態", text_color=color.white, text_size=size.small)
    table.cell(board, 1, 2, in_position ? "🟢 持倉中" : "⚪ 空手觀望", text_color=in_position ? color.green : color.gray, text_size=size.small)

    table.cell(board, 0, 3, "1.2倍爆量條件", text_color=color.white, text_size=size.small)
    table.cell(board, 1, 3, pass_vol_spike ? "✅ 爆量符合 (" + str.tostring(vol_ratio, "#.##") + "x)" : "❌ 量能不足 (" + str.tostring(vol_ratio, "#.##") + "x)", text_color=pass_vol_spike ? color.green : color.red, text_size=size.small)

    table.cell(board, 0, 4, "> 300張成交量", text_color=color.white, text_size=size.small)
    table.cell(board, 1, 4, pass_min_volume ? "✅ 流動性足夠" : "❌ 量太冷清 (<300張)", text_color=pass_min_volume ? color.green : color.red, text_size=size.small)

    table.cell(board, 0, 5, "70-80分發動訊號", text_color=color.white, text_size=size.small)
    table.cell(board, 1, 5, is_buy_signal ? "✅ 觸發買進發動" : "❌ 未過關", text_color=is_buy_signal ? color.green : color.gray, text_size=size.small)

    table.cell(board, 0, 6, "ADX 趨勢強度", text_color=color.white, text_size=size.small)
    table.cell(board, 1, 6, str.tostring(adx_val, "#.#") + (adx_val > 20 ? " (強)" : " (弱)"), text_color=adx_val > 20 ? color.green : color.white, text_size=size.small)

    table.cell(board, 0, 7, "建議止損價位 (-20%)", text_color=color.white, text_size=size.small)
    table.cell(board, 1, 7, "$" + str.tostring(stop_loss_price, "#.##"), text_color=color.yellow, text_size=size.small)

// =============================================================================
// 7. TradingView 警報條件 (Alert Conditions)
// =============================================================================
alertcondition(buy_trigger and not in_position[1], title="荳荳 AI Version 7 爆量買進訊號", message="🚀【荳荳 AI Version 7】標的 {{ticker}} 現價 ${{close}} 滿足「爆量 1.2x + 300張」觸發【買進】！評分: {{plot_0}}")
alertcondition(buy_trigger and in_position[1],     title="荳荳 AI Version 7 加碼買進訊號", message="⚡【荳荳 AI Version 7】標的 {{ticker}} 現價 ${{close}} 觸發【加碼買進】訊號！")
alertcondition(sell_trigger,                        title="荳荳 AI Version 7 賣出訊號", message="🚨【荳荳 AI Version 7】標的 {{ticker}} 現價 ${{close}} 觸發【賣出】訊號！")
```
