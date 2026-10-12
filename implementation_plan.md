# 荳荳 AI 籌碼防禦與資金流向升級計畫 (方案A執行與每日狗狗提醒彈窗)

本計畫包含對「荳荳每日盤後風向提醒 (狗狗口吻)」以及「荳花漲跌區塊偵測 (軸線合流)」的技術實作方案。已全面避免著作權詞彙。

---

## 🛠️ 修改內容摘要

### 📌 1. 狗狗盤後風向彈窗提醒 (Dog Reminder Modal)
*   **目標**：將原有的盤後小結卡片自首頁 Dashboard 移除，轉為每日首次啟動系統時的彈窗提醒。以熱情貼心的狗狗口吻，提醒主人今日法人動態，並提供「🐾 摸狗狗頭 (我知道了)」與 `✕` 按鈕。
*   **實作位置**：
    - [index.html](file:///c:/GoogleAntigravity/2026Trading1/index.html)：
      - 從儀表板主視圖中**刪除** `#postmarketSummaryPanel`。
      - 新增全螢幕遮罩 `#dogReminderModal` 容器，內部為玻璃擬態彈窗。
    - [style.css](file:///c:/GoogleAntigravity/2026Trading1/style.css)：
      - 新增彈窗遮罩與 `.modal-content-glass` 樣式。
    - [app.js](file:///c:/GoogleAntigravity/2026Trading1/app.js)：
      - 實作 `showDogReminder()`，採用擬人（狗）口吻拼接數據，如：「*主人汪！荳荳幫你整理了今天的盤後籌碼汪！今天法人最喜歡的防禦避風港是... 摸摸我的頭我知道了汪！🐾*」。
      - 實作 `closeDogReminder()`，在關閉時將今日日期存入 `localStorage.setItem('trading_ai_last_remind_date', todayStr)`。
      - 在載入數據完成後，比對今日日期，若當日尚未提醒過，則自動彈出。

### 📌 2. 荳花漲跌區塊偵測 (方案 A - 軸線合流)
*   **目標**：在不新增冗餘報表的前提下，於原有泡泡圖增加切換開關，提供量能流向與大戶籌碼流向的多維度切換。
*   **實作位置**：
    - [index.html](file:///c:/GoogleAntigravity/2026Trading1/index.html)：
      - 在「🔥 荳花漲跌區塊偵測」面板標題旁新增一個 `<select id="bubble-axis-mode" onchange="changeBubbleAxisMode()">` 下拉切換選單。
    - [app.js](file:///c:/GoogleAntigravity/2026Trading1/app.js)：
      - 實作 `changeBubbleAxisMode()`。
      - 重構 `renderSectorFlowMap()` 繪圖邏輯：
        *   **【量能與流向模式】**（原設定）：X軸量能比，Y軸估算資金淨流向。
        *   **【三大法人籌碼分析模式】**（新設定）：
            - X 軸 (法人5D累計)：板塊內股票近 5 日三大法人累計買賣超平均值。
            - Y 軸 (當日法人加速度)：當日法人買超量與近 5 日均線的差值平均值。
            - 泡泡大小：近 20 日法人累計買超平均值的絕對值。
            - 著色與象限：自動套用「主力加碼、買盤放緩、低檔築底、主力減碼」象限分佈。

---

## 📂 預計修改檔案

- **[MODIFY] [index.html](file:///c:/GoogleAntigravity/2026Trading1/index.html)**
  - 移除首頁固定卡片。
  - 新增 `#dogReminderModal` 與 `#bubble-axis-mode` 下拉選單。
- **[MODIFY] [app.js](file:///c:/GoogleAntigravity/2026Trading1/app.js)**
  - 重構 `renderSectorFlowMap()` 並串聯雙軸線繪圖。
  - 實作 `showDogReminder()`, `closeDogReminder()`, `changeBubbleAxisMode()`。
  - 修改資料載入完成後的提醒檢查邏輯。
- **[MODIFY] [style.css](file:///c:/GoogleAntigravity/2026Trading1/style.css)**
  - 新增 `.modal-content-glass` 玻璃質感動效與排版樣式。

---

## 🧪 驗證與測試計畫

### 自動化驗證 (Browser Subagent)
1.  **狗狗提醒彈窗**：
    - 清空 LocalStorage 中的 `trading_ai_last_remind_date`，重載頁面，驗證是否自動彈出狗狗提醒玻璃彈窗，且語音口吻正確。
    - 點選「🐾 摸狗狗頭 (我知道了)」或 `✕` 關閉彈窗，重載頁面，驗證彈窗在當天內不再重複出現。
2.  **泡泡圖軸線切換**：
    - 切換「荳花漲跌區塊偵測」的下拉選單至「三大法人籌碼分析」，確認泡泡位置、軸線文字與泡泡大小自動刷新，且象限劃分正確。
