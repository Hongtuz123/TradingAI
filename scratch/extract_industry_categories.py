from bs4 import BeautifulSoup
import re

with open("scratch/cmoney_category.html", "r", encoding="utf-8") as f:
    html_content = f.read()

soup = BeautifulSoup(html_content, "html.parser")

# 觀察 CMoney 分類頁面的結構。通常會有不同的板塊區塊，每個區塊有標題和內部的連結。
# 我們來尋找包含 Cxxxxx 連結的父級區塊。
# 打印一些包含 C\d+ 的 div 父級標籤及其兄弟標籤，來找出產業名稱。

# 我們可以直接找出所有 <a> 標籤，然後往上找有 class 或 header 的元素。
links = soup.find_all("a", href=re.compile(r"/forum/category/C\d+"))

print("Analyzing DOM hierarchy for categories:")
for link in list(links)[:10]:
    href = link.get("href")
    text = link.get_text(strip=True)
    
    # 往上尋找包含標題的父元素
    parent = link.parent
    headers = []
    for _ in range(5):
        if not parent:
            break
        # 尋找這個 parent 內的所有標題
        for h in parent.find_all(["h1", "h2", "h3", "h4", "h5", "div"]):
            h_text = h.get_text(strip=True)
            # 如果 h_text 是常見的板塊名，記錄下來
            if h_text in ["傳產", "金融", "電子上游", "電子中游", "電子下游", "其他", "生技醫療", "軟體"]:
                headers.append(h_text)
        parent = parent.parent
    
    print(f"Category: {text} ({href}) -> Traversed Headers: {list(set(headers))}")
