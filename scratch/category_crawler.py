import os
import re
import csv
import json
import requests
import subprocess
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor, as_completed

# 設定路徑
BASE_DIR = r"c:\GoogleAntigravity\2026Trading1"
SCRATCH_DIR = os.path.join(BASE_DIR, "scratch")
CSV_PATH = os.path.join(BASE_DIR, "個股產業分類對照表.csv")
MAIN_HTML_PATH = os.path.join(SCRATCH_DIR, "cmoney_category.html")
TEMP_JS_PATH = os.path.join(SCRATCH_DIR, "temp_eval.js")

# 確保目錄存在
os.makedirs(SCRATCH_DIR, exist_ok=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": "https://www.google.com/"
}

def get_main_categories():
    """解析大分類頁面，取得所有分類 ID、分類名稱和所屬大產業"""
    # 優先使用本地暫存檔案，避免頻繁請求被阻擋
    if os.path.exists(MAIN_HTML_PATH):
        with open(MAIN_HTML_PATH, "r", encoding="utf-8") as f:
            html_content = f.read()
    else:
        print("下載主分類頁面...")
        response = requests.get("https://www.cmoney.tw/forum/category", headers=HEADERS, timeout=15)
        response.raise_for_status()
        html_content = response.text
        with open(MAIN_HTML_PATH, "w", encoding="utf-8") as f:
            f.write(html_content)

    soup = BeautifulSoup(html_content, "html.parser")
    links = soup.find_all("a", href=re.compile(r"/forum/category/C\d+"))
    
    category_list = []
    seen_ids = set()

    for link in links:
        href = link.get("href")
        text = link.get_text(strip=True)
        
        match = re.search(r"/(C\d+)", href)
        if not match:
            continue
        cat_id = match.group(1)
        
        if cat_id in seen_ids:
            continue
        seen_ids.add(cat_id)

        # 往上追溯父元素，確定其所屬的「大產業」
        parent = link.parent
        industry = "傳產" # 預設
        found_industry = False
        
        for _ in range(6):
            if not parent:
                break
            for h in parent.find_all(["h1", "h2", "h3", "h4", "h5", "div"]):
                h_text = h.get_text(strip=True)
                if h_text in ["傳產", "金融", "電子上游", "電子中游", "電子下游", "其他", "生技醫療", "軟體"]:
                    industry = h_text
                    found_industry = True
                    break
            if found_industry:
                break
            parent = parent.parent
            
        category_list.append({
            "id": cat_id,
            "name": text,
            "industry": industry
        })
        
    print(f"成功解析出 {len(category_list)} 個細分分類！")
    return category_list

def fetch_single_category(cat_info):
    """抓取單一細分分類頁面，解析其個股清單"""
    cat_id = cat_info["id"]
    cat_name = cat_info["name"]
    industry = cat_info["industry"]
    
    url = f"https://www.cmoney.tw/forum/category/{cat_id}"
    print(f"正在爬取 {industry} -> {cat_name} ({cat_id})...")
    
    try:
        response = requests.get(url, headers=HEADERS, timeout=15)
        if response.status_code != 200:
            print(f"警告: {cat_name} ({cat_id}) 回傳非 200 狀態碼: {response.status_code}")
            return []
            
        html = response.text
        # 尋找 window.__NUXT__
        match = re.search(r"window\.__NUXT__\s*=\s*([\s\S]+?);\s*<\/script>", html)
        if not match:
            print(f"警告: {cat_name} ({cat_id}) 網頁中找不到 window.__NUXT__")
            return []
            
        nuxt_js = match.group(1)
        
        # 為了安全執行，將 JS 代碼寫入 temp 檔案，然後用 node 執行 eval 得到乾淨的個股 JSON
        # 這樣可完全避開 Command-line 長度限制
        js_runner = f"""
const window = {{}};
try {{
  window.__NUXT__ = {nuxt_js};
  const result = [];
  const data = window.__NUXT__;
  const stockList = (data && data.data && data.data[0] && data.data[0].stockList) || [];
  const stockDict = (data && data.state && data.state.global && data.state.global.stockDict) || {{}};
  
  for (const s of stockList) {{
    const code = s.stockId;
    const name = (stockDict[code] && stockDict[code].name) || s.stockName || "";
    if (code) {{
      result.push({{ code, name }});
    }}
  }}
  console.log(JSON.stringify(result));
}} catch (e) {{
  console.error("Eval error:", e.message);
}}
"""
        # 使用線程安全的獨立 temp 檔名
        temp_file = os.path.join(SCRATCH_DIR, f"temp_{cat_id}.js")
        with open(temp_file, "w", encoding="utf-8") as f:
            f.write(js_runner)
            
        # 呼叫 node 執行
        proc = subprocess.run(["node", temp_file], capture_output=True, text=True, encoding="utf-8")
        
        # 刪除 temp 檔案
        if os.path.exists(temp_file):
            try:
                os.remove(temp_file)
            except:
                pass
                
        if proc.returncode != 0:
            print(f"錯誤: 執行 Node.js 解析 {cat_name} ({cat_id}) 失敗: {proc.stderr}")
            return []
            
        output = proc.stdout.strip()
        if not output:
            return []
            
        stocks = json.loads(output)
        print(f"成功: {industry} -> {cat_name} ({cat_id}) 解析出 {len(stocks)} 檔股票！")
        
        # 格式化成 CSV 列
        rows = []
        for s in stocks:
            rows.append({
                "產業": industry,
                "分類": cat_name,
                "股票代碼": s["code"],
                "股票名稱": s["name"]
            })
        return rows
        
    except Exception as e:
        print(f"爬取/解析 {cat_name} ({cat_id}) 時發生異常: {e}")
        return []

def main():
    # 1. 取得大分類列表
    categories = get_main_categories()
    
    all_rows = []
    
    # 2. 併發爬取所有細分分類 (限制 Max Workers 避免請求過快)
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(fetch_single_category, cat): cat for cat in categories}
        for future in as_completed(futures):
            res = future.result()
            if res:
                all_rows.extend(res)
                
    # 3. 排序 (依產業、分類、代碼排序，乾淨整齊)
    all_rows.sort(key=lambda x: (x["產業"], x["分類"], x["股票代碼"]))
    
    # 4. 寫入 CSV 檔案
    with open(CSV_PATH, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["產業", "分類", "股票代碼", "股票名稱"])
        writer.writeheader()
        writer.writerows(all_rows)
        
    print(f"\n恭喜！全部爬取並彙整完畢。")
    print(f"共匯入 {len(all_rows)} 筆個股產業分類資料！")
    print(f"CSV 檔案路徑: {CSV_PATH}")

if __name__ == "__main__":
    main()
