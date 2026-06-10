# 荳荳 AI 選股系統 — Antigravity 專案規則

## ⚠️ 強制工作流程（MANDATORY WORKFLOW）

### 每次系統功能修改後，必須：

1. **Git Commit**
   ```powershell
   git add -A; git commit -m "描述本次修改內容"
   ```
   - Commit message 使用繁體中文，說明改了什麼功能
   - 即使只改一行也要 commit，不能累積再一起提交

2. **部署至 Vercel（Production）**
   ```powershell
   npx vercel --prod --yes 2>&1
   ```
   - 必須等待部署完成確認成功後才結束本次任務
   - 部署完成後回報線上網址

### 適用範圍（以下異動均觸發此規則）
- `app.js` — 主邏輯與互動功能
- `index.html` — 頁面結構與 DOM
- `style.css` — 樣式與版面
- `stock-dashboard.js` — K 線圖與回測功能
- `screener.py` — 選股運算與資料產生
- 任何新增的 `.js` / `.html` / `.css` / `.py` 檔案

### 不觸發此規則（以下異動可選擇不部署）
- `data.js` — 由 screener.py 自動產生的資料檔，每日定時更新
- `scratch/` 資料夾內的測試腳本
- `.md` 文件類

---

## 🛠️ 技術架構摘要

| 檔案 | 用途 |
|------|------|
| `index.html` | 主頁面結構（儀表板、篩選器、回測功能等 tab） |
| `app.js` | 所有 UI 互動、篩選邏輯、市場健康度渲染 |
| `stock-dashboard.js` | K 線圖（lightweight-charts）、回測功能 |
| `style.css` | 深色主題樣式系統 |
| `screener.py` | Python 後端：抓取台股資料、計算選股評分、輸出 data.js |
| `data.js` | 靜態資料快照（由 screener.py 每日產生，不手動編輯）|

## 🌐 線上網址
- **Production**: https://trading-ai-eosin-zeta.vercel.app

## 📐 設計系統
- 深色主題（Dark Mode），主色 `#f97316`（橘）
- 字體：Inter + Noto Sans TC
- 框架：純 HTML/CSS/JS（無 npm 框架）
- 圖表：lightweight-charts v5（standalone）
