from bs4 import BeautifulSoup
import re

with open("scratch/cmoney_category.html", "r", encoding="utf-8") as f:
    html_content = f.read()

soup = BeautifulSoup(html_content, "html.parser")
links = soup.find_all("a", href=re.compile(r"/forum/category/C\d+"))

categories = {}
for link in links:
    href = link.get("href")
    text = link.get_text(strip=True)
    # 提取 Cxxxxx ID
    match = re.search(r"/(C\d+)", href)
    if match:
        cat_id = match.group(1)
        if text:
            categories[cat_id] = text

print(f"Found {len(categories)} categories:")
for cid, name in sorted(categories.items()):
    print(f"{cid}: {name}")
