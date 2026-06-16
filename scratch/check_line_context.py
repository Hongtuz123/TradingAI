with open("c:/GoogleAntigravity/2026Trading1/data.js", "r", encoding="utf-8") as f:
    content = f.read()

pos = 0
idx = 1
while True:
    pos = content.find("廣閎科", pos)
    if pos == -1:
        break
    print(f"\n=== Occurrence {idx} (char position {pos}) ===")
    start = max(0, pos - 100)
    end = min(len(content), pos + 300)
    snippet = content[start:end]
    print(snippet)
    pos += 3
    idx += 1
