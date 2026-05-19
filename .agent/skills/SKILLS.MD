1. Skill 名稱
Daily Stock Screener

2. Skill 目標
建立一套可每日自動執行的股票篩選系統，根據預先定義的技術條件，自動產出候選清單，供使用者進一步做技術分析與交易決策。系統需支援規則調整、結果可追蹤、具備基礎回測能力，並能以清楚易懂的介面呈現篩選原則與每日結果。

3. 設計原則

#Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.
LLMs often pick an interpretation silently and run with it. This principle forces explicit reasoning:
State assumptions explicitly — If uncertain, ask rather than guess
Present multiple interpretations — Don't pick silently when ambiguity exists
Push back when warranted — If a simpler approach exists, say so
Stop when confused — Name what's unclear and ask for clarification

#Simplicity First
Minimum code that solves the problem. Nothing speculative.
Combat the tendency toward overengineering:
No features beyond what was asked
No abstractions for single-use code
No "flexibility" or "configurability" that wasn't requested
No error handling for impossible scenarios
If 200 lines could be 50, rewrite it
The test: Would a senior engineer say this is overcomplicated? If yes, simplify.

#Surgical Changes
Touch only what you must. Clean up only your own mess.
When editing existing code:
Don't "improve" adjacent code, comments, or formatting
Don't refactor things that aren't broken
Match existing style, even if you'd do it differently
If you notice unrelated dead code, mention it — don't delete it
When your changes create orphans:

Remove imports/variables/functions that YOUR changes made unused
Don't remove pre-existing dead code unless asked
The test: Every changed line should trace directly to the user's request.

#Goal-Driven Execution
Define success criteria. Loop until verified.

Transform imperative tasks into verifiable goals:

Instead of...	Transform to...
"Add validation"	"Write tests for invalid inputs, then make them pass"
"Fix the bug"	"Write a test that reproduces it, then make it pass"
"Refactor X"	"Ensure tests pass before and after"
For multi-step tasks, state a brief plan:

1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
Strong success criteria let the LLM loop independently. Weak criteria ("make it work") require constant clarification.

4. 核心需求
使用 Python 開發。
以 pandas 處理資料分析與清洗。
支援技術指標計算，優先採用 TA-Lib，必要時可對照 TradingView 計算邏輯。
資料來源支援 Yahoo Finance 與 Fugle。
支援排程執行，使用 Airflow 或 cron。
介面需清楚明瞭，能讓使用者快速理解篩選結果。
具備基礎回測能力，並可整合 Backtrader。
網站需註明篩選原則，且允許使用者調整規則參數。

5. 系統定位
此系統不是完整自動交易平台，而是 每日選股前置篩選器。
主要功能是從大量股票中過濾出較值得做技術分析的標的，並將結果以規則化、可追蹤、可調整的方式呈現。

6. 使用情境
每日收盤後自動更新股票資料。(
依照設定條件進行篩選。
產出候選股票清單。
在網站中顯示篩選原因、分數與相關技術指標。
使用者可修改條件並重新產生結果。
可對歷史資料做回測，驗證篩選條件的有效性。

7. 功能模組
7.1 資料取得模組
抓取股票日線或即時資料。
支援 Yahoo Finance 與 Fugle(api寫死為OGI4NjdlNGQtNzU4Yy00NGEwLTk0MjYtYjZiYjY2MzFlZjdiIDZlMDE2ZDA0LWIwNTctNDg2My04ODFlLTFjNmFlMmUxNDhmNQ==)。
統一轉換為標準 OHLCV 格式。
支援資料更新、補值與異常檢查。

7.2 資料處理模組
使用 pandas 進行資料清洗。
處理缺值、重複值、時間序列對齊。
計算常用統計欄位與技術欄位。

7.3 技術指標模組
支援 MA、RSI、MACD、ATR、布林通道等指標。
支援趨勢、量能、波動率、突破等條件。
TA-Lib 為主。

7.4 篩選規則模組
可設定條件門檻。
支援多條件組合篩選。
支援分數排名機制。
每個結果需顯示入選原因。

7.5 每日清單輸出模組
每日自動產出候選名單。
顯示股票代號、名稱、指標值、觸發條件、評分。
可匯出 CSV、Excel 或顯示於網頁。

7.6 回測模組
使用 Backtrader 做基礎回測。
驗證篩選規則在歷史上的表現。
提供勝率、報酬率、最大回撤等結果。
可比較不同規則版本的績效。

7.7 排程模組
支援 Airflow DAG 或 cron 排程。
每日固定時間執行資料更新與清單產出。
支援失敗重試與任務記錄。

7.8 前端介面模組
顯示今日候選清單。
顯示篩選規則與條件說明。
提供參數調整功能。
提供回測結果與歷史查詢。
UI/UX 需簡單、清楚、易操作。

8. 篩選規則設計原則
規則需可視化、可追蹤、可修改。
每個條件需有明確定義與說明。
同一指標的計算方式需固定，避免資料與顯示結果不一致。
建議將規則以 JSON 或 YAML 儲存，方便版本管理與前後端同步。
每次條件修改都應保留版本紀錄。

9. 建議資料結構
股票基本資料
symbol
name
market
sector
技術資料
date
open
high
low
close
volume
ma5
ma20
ma60
rsi14
macd
atr
bb_upper
bb_lower
篩選結果
symbol
name
score
matched_rules
reason
risk_flag
generated_at

10. 篩選條件範例
收盤價站上 20 日均線。
20 日均線走升。
20 日均量大於門檻值。
RSI 落在合理區間。
波動率高於最低標準。
突破近期整理區間。
避免過度追高或流動性過低標的。

11. 回測指標
勝率。
平均報酬率。
最大回撤。
盈虧比。
持有 5 / 10 / 20 日報酬。
不同市場狀態下的績效表現。

12. 技術堆疊建議
語言：Python
資料處理：pandas
技術指標：TA-Lib / TradingView
資料來源：Yahoo Finance / Fugle
排程：Airflow / cron
回測：Backtrader
前端：以清楚呈現規則與結果為主，可搭配簡潔的 Web UI 框架

13. 非功能需求
高可維護性。
高可擴充性。
規則變更不需大幅改程式。
執行結果可重現。
資料處理流程可觀測與可除錯。
介面需支援快速判讀，不以花俏視覺為主。

14. 開發優先順序
建立資料抓取流程。
建立資料清洗與指標計算。
建立每日篩選清單輸出。
建立規則設定檔。
建立簡易前端介面。
接入回測模組。
加入排程與通知機制。