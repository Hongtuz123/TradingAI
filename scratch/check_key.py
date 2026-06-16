import re

with open("c:/GoogleAntigravity/2026Trading1/data.js", "r", encoding="utf-8") as f:
    lines = f.readlines()

target_line = 3770175
print(f"Scanning upwards from line {target_line} to find first-level key under marketData...")

for i in range(target_line - 1, 0, -1):
    line = lines[i]
    # Look for keys formatted as '  "key": [' (exactly 2 spaces indentation)
    if line.startswith('  "'):
        # Parse key name
        match = re.match(r'^\s*"([^"]+)"\s*:\s*\[', line)
        if match:
            print(f"Found first-level parent key: '{match.group(1)}' at line {i+1}")
            break
        # Also check if it's a key of an object
        match_obj = re.match(r'^\s*"([^"]+)"\s*:\s*\{', line)
        if match_obj:
            print(f"Found first-level parent object key: '{match_obj.group(1)}' at line {i+1}")
            break

# Print the object details directly from lines around 3770175
print("\nTarget object lines:")
for idx in range(target_line - 2, target_line + 15):
    print(f"Line {idx+1}: {lines[idx].strip()}")
