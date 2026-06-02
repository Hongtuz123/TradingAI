with open("scratch/cmoney_category.html", "r", encoding="utf-8") as f:
    text = f.read()

print("File size (chars):", len(text))
print("Is 'category' in text?", "category" in text)
print("Is 'head' in text?", "head" in text)
print("Is 'body' in text?", "body" in text)

# 看看是不是有任何中文字
import re
chinese_chars = re.findall(r"[\u4e00-\u9fff]", text)
print("Number of Chinese characters:", len(chinese_chars))
if chinese_chars:
    print("Sample Chinese characters:", "".join(chinese_chars[:50]))

# 搜尋所有 script text
scripts = re.findall(r"<script.*?>([\s\S]*?)</script>", text)
print("Number of script tags:", len(scripts))
for i, s in enumerate(scripts):
    print(f"Script {i} length: {len(s)}")
    if len(s) > 1000:
        print(f"Script {i} preview: {s[:200]} ... {s[-200:]}")
