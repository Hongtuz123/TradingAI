import requests

url = "https://www.cmoney.tw/forum/category"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
}
response = requests.get(url, headers=headers)
with open("scratch/cmoney_category.html", "w", encoding="utf-8") as f:
    f.write(response.text)
print("Done. Saved to scratch/cmoney_category.html")
