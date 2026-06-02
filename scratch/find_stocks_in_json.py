import json

with open("scratch/cement_dump.json", "r", encoding="utf-8") as f:
    data = json.load(f)

# 我們來遞迴尋找 1101 或是 亞泥
def search_nested_paths(obj, target, path=""):
    results = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if str(target) == str(k) or str(target) == str(v):
                results.append((f"{path}.{k}", type(v), str(v)[:100]))
            results.extend(search_nested_paths(v, target, f"{path}.{k}"))
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            if str(target) == str(item):
                results.append((f"{path}[{i}]", type(item), str(item)[:100]))
            results.extend(search_nested_paths(item, target, f"{path}[{i}]"))
    return results

found_1101 = search_nested_paths(data, "1101")
print("Found '1101' at:")
for f in found_1101[:10]:
    print(f)

found_1102 = search_nested_paths(data, "1102")
print("\nFound '1102' at:")
for f in found_1102[:10]:
    print(f)
