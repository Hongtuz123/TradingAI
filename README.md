# 荳荳 AI 股票篩選與選股系統 (無伺服器高相容版) 🚀

本系統已改造成 **「無伺服器（Serverless）高相容版」**。此版本不需要 24 小時長駐本地後端伺服器，可在 GitHub Pages 或 Vercel 等靜態託管平台**完全免費**且**安全**地運行。

---

## 🛠️ 核心優化成果
1. **路徑相對化**：`screener.py` 與 `啟動系統.bat` 全面改用相對路徑，任何電腦雙擊即可直接執行。
2. **智慧離線 Fallback**：前端 `stock-dashboard.js` 內建防斷線機制。若無 API 後端，網頁將自動讀取 `data.js` 自帶的 120 天日 K 線數據，確保網頁功能與圖表 100% 完美呈現。
3. **自動定時排程**：配置了 GitHub Actions 工作流。每個台股交易日下午 **13:40** 自動在雲端執行跑盤，抓取最新日 K 資料並推送回儲存庫更新。

---

## 🌐 雲端部署與定時更新設定指南

### 第一步：開啟 GitHub Actions 寫入權限 (重要 ⚠️)
為了讓 GitHub Actions 能在跑完盤後將最新資料 `data.js` 寫回您的 Repository，請在 GitHub 網頁端完成以下設定：
1. 進入該儲存庫的 **Settings** -> **Actions** -> **General**。
2. 滾動到最下方的 **Workflow permissions**。
3. 將預設的 *Read repository contents and packages permissions* 改選為 **Read and write permissions**。
4. 點擊 **Save** 保存。

---

### 第二步：在 Vercel 上免費託管與發布網頁 (最推薦 🚀)
使用 Vercel 部署非常快速，且能完美同步您的私有/公開儲存庫更新：
1. 登入 [Vercel 官網](https://vercel.com/)。
2. 點擊 **Add New** -> **Project**，匯入此儲存庫 (`Hongtuz123/TradingAI`)。
3. 無須更改任何編譯指令 (Build Command)，直接點選 **Deploy**！
4. 部署完成後，Vercel 會提供專屬的網址 (例如 `https://your-project.vercel.app`)。
5. 往後不論是 GitHub Actions 定時跑盤，還是您手動點擊更新，Vercel 都會在 GitHub 更新後的 10 秒內**自動同步並重新發布最新網頁**，您完全不需要手動上傳任何檔案！

---

## 💻 本地執行方式
若您想在自己的電腦上運行：
* **雙擊 `啟動系統.bat`**：系統將自動於背景啟動本地 FastAPI 後端，並以 Chrome 開啟看盤網頁。
* **手動更新資料**：執行 `python screener.py` 即可手動重新跑盤抓取最新數據。
