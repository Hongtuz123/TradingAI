import re

with open("scratch/cement_category.html", "r", encoding="utf-8") as f:
    text = f.read()

print("File size:", len(text))
# 搜尋是否有台泥的 Unicode 逸出 (台= \u53f0, 泥= \u6ce5)
# 1101 是否也存在？
print("Is '1101' in text?", "1101" in text)
print("Is '\\u53f0\\u6ce5' (台泥) in text?", "\\u53f0\\u6ce5" in text)
print("Is 'u53f0' in text?", "u53f0" in text)

# 看看是否有任何中文字
chinese = re.findall(r"[\u4e00-\u9fff]", text)
print("Chinese chars count:", len(chinese))
if chinese:
    print("Sample:", "".join(chinese[:100]))

# 搜尋所有的 script tags 內容
scripts = re.findall(r"<script.*?>([\s\S]*?)</script>", text)
print("Scripts count:", len(scripts))
for i, s in enumerate(scripts):
    if len(s) > 5000:
        print(f"Script {i} length: {len(s)}")
        print(f"Script {i} preview: {s[:300]} ... {s[-300:]}")
