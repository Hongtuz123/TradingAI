import json

with open("scratch/sector_history.json", "r", encoding="utf-8") as f:
    sec_hist = json.load(f)

with open("data.json", "r", encoding="utf-8") as f:
    data = json.load(f)

data["marketData"]["sectorHistory"] = sec_hist

with open("data.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print("data.json sectorHistory updated successfully!")
