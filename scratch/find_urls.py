import re

with open("scratch/cmoney_category.html", "r", encoding="utf-8") as f:
    text = f.read()

# 搜尋以 http 或 https 開頭的網址，或者 /api/
urls = re.findall(r'https?://[^\s"\'<>]+', text)
print("Total absolute URLs found:", len(urls))

unique_domains = set()
for url in urls:
    match = re.match(r'https?://([^/]+)', url)
    if match:
        unique_domains.add(match.group(1))

print("Unique domains:", unique_domains)

# 搜尋包含 api 或 category 的路徑
api_paths = re.findall(r'/[^\s"\'<>]*?api[^\s"\'<>]*', text)
print("Paths containing 'api':", len(api_paths))
for p in list(set(api_paths))[:20]:
    print(p)

category_paths = re.findall(r'/[^\s"\'<>]*?category[^\s"\'<>]*', text)
print("Paths containing 'category':", len(category_paths))
for p in list(set(category_paths))[:20]:
    print(p)
