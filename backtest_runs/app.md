# 📱 荳荳 AI 手機原生推播與極簡 App 開發評估報告 (app.md)

> **建立時間**：2026-08-10  
> **專案位置**：`C:\GoogleAntigravity\2026Trading1\backtest_runs\app.md`  
> **核心宗旨**：輕 App、重推播。去除 App 內複雜昂貴的 K 線圖與自選股開發，專注於手機系統原生推播通知，點擊後自動跳轉至 TradingView 觀看特定標的 K 線。

---

## 🎯 一、 核心需求與設計理念

1. **極簡化原則 (Simplicity First)**：
   - **不在 App 內刻 K 線圖與自選股清單**，避免重複造輪子與龐大維護成本。
   - 利用 TradingView 原生高顏值圖表，發揮最大效益。
2. **手機原生系統推播 (System Push Notification)**：
   - 盤中/24hr 觸發 🟢買進 / 🔵加碼 / 🔴賣出 訊號時，手機鎖屏或背景第一時間跳出系統通知。
3. **一鍵跳轉 TradingView (Deep Link)**：
   - 點擊手機推播卡片，自動喚起手機內建的 TradingView App 或專屬 K 線網頁，直達該標的畫面。

---

## 📐 二、 兩大黃金開發方案評估

### 🏆 方案 A：PWA 輕量化 Web App（最推薦！免上架、最快 2~3 天上線）
- **技術架構**：Web Push API + Progressive Web App (PWA) + OneSignal / Firebase (FCM)。
- **使用流程**：
  1. 手機（iOS 16.4+ / Android）開啟網頁，點擊「加入主畫面」即可生成獨立 App 圖示。
  2. 開啟 App 允許推播通知即可完成綁定。
- **優勢**：
  - 零審核風險、免負擔 Apple 開發者帳號年費 ($99 USD/年)。
  - 開發速度最快（預估 2~3 天）。
  - iOS 與 Android 100% 雙平台原生系統推播支援。

---

### 🚀 方案 B：Flutter / React Native 跨平台 Native App
- **技術架構**：Flutter / React Native (Expo) + APNs (Apple Push) + FCM (Google Cloud Messaging)。
- **使用流程**：打包成 `.ipa` (iOS) 與 `.apk` (Android) 經 App Store / Google Play 下載安裝。
- **極簡介面**：
  - **頁面 1【訊號歷史紀錄】**：查看歷史推播卡片列表。
  - **頁面 2【推播偏好設定】**：設定分數門檻 (如 70 分以上才響)、夜間靜音模式等。
- **優勢**：
  - 品牌完整度高、推播到達率與穩定度 100%。

---

## 🔗 三、 TradingView 專屬 Deep Link 網址規範

後端（台股 `screener.py` 與幣圈 `live_monitor_discord.py`）推播時自動帶入動態網址：

- **台股上市 (TSE)**：
  `https://www.tradingview.com/chart/?symbol=TWSE:2330` (台積電)
- **台股上櫃 (OTC)**：
  `https://www.tradingview.com/chart/?symbol=TPEX:6907` (華勝-KY)
- **加密貨幣 (Crypto Spot/Futures)**：
  `https://www.tradingview.com/chart/?symbol=BINANCE:DOGEUSDT` (DOGE)

> **手機行為**：若手機已安裝 TradingView App，點擊連結時 OS 會自動調起原生 TradingView App；若未安裝則開啟瀏覽器版 K 線圖。

---

## 🛠️ 四、 後端推播系統需擴充之 3 大模組

1. **User Push Token 資料庫 (`push_tokens.json` 或 Supabase)**：
   - 儲存使用者手機安裝後訂閱的 FCM Token / Web Push Token。
2. **動態推播觸發器 (`push_notifier.py`)**：
   - 當觸發 🟢買進 / 🔵加碼 訊號時，同步向 FCM / OneSignal API 發送 Request。
3. **Deep Link 自動化配對器**：
   - 依據標的代號自動生成 TradingView 專屬網址並附加於 Payload 中。

---

## 📊 五、 開發工期與成本對比表

| 評估維度 | 方案 A (PWA Web Push) | 方案 B (Native App) |
| :--- | :---: | :---: |
| **預估工期** | **2 ~ 3 天** | **5 ~ 7 天** |
| **開發者帳號成本** | **$0** (無需上架) | $99/年 (Apple) + $25 (Google) |
| **審核流程** | **即時上線 (免審核)** | 1 ~ 3 天 (審核被退風險) |
| **使用者安裝方式** | 「加入主畫面」即可 | 商店搜尋下載 |
| **TradingView 跳轉** | 100% 支援 | 100% 支援 |

---

## 📌 六、 未來調用指引

當需要啟動本 App 開發時，只需在 Prompt 對 Antigravity 發出指令：
> **「請調用 C:\GoogleAntigravity\2026Trading1\backtest_runs\app.md，準備啟動 App 推播開發」**

Antigravity 將會直接加載此份架構規格，並開始撰寫後端 FCM 推播模組與前端 Service Worker/PWA 程式碼！
