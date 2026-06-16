with open("c:/GoogleAntigravity/2026Trading1/data.js", "r", encoding="utf-8") as f:
    lines = f.readlines()

# The target line was 3770175/3770176
# Let's print from line 3770160 to 3770200 to see the object context.
start = 3770160
end = 3770200
print(f"Printing lines {start} to {end}:")
for idx in range(start - 1, end):
    print(f"Line {idx+1}: {lines[idx].strip()}")
