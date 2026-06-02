import json

with open("scratch/nuxt_dump.json", "r", encoding="utf-8") as f:
    data = json.load(f)

# 看看 data['data'] 的內容
print("Keys of data:", data.keys())
print("data['data'][0] type:", type(data['data'][0]))
print("data['data'][0] keys:", data['data'][0].keys() if isinstance(data['data'][0], dict) else "Not dict")

# 遞迴尋找任何字典裡的 key 或 value 包含中文字，或者印出資料夾深度
def search_nested(obj, path=""):
    results = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if "水泥" in str(k) or "水泥" in str(v):
                results.append((f"{path}.{k}", type(v), str(v)[:100]))
            results.extend(search_nested(v, f"{path}.{k}"))
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            if "水泥" in str(item):
                results.append((f"{path}[{i}]", type(item), str(item)[:100]))
            results.extend(search_nested(item, f"{path}[{i}]"))
    return results

found = search_nested(data)
print("Found '水泥' occurrences:", len(found))
for f in found[:20]:
    print(f)
