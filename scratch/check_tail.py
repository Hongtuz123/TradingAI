with open("c:/GoogleAntigravity/2026Trading1/data.js", "r", encoding="utf-8") as f:
    lines = f.readlines()

print(f"Total lines in data.js: {len(lines)}")
print("Last 30 lines of data.js:")
for i in range(len(lines) - 30, len(lines)):
    print(f"Line {i+1}: {lines[i].strip()}")
