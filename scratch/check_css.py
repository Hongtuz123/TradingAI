import sys

with open('style.css', 'r', encoding='utf-8') as f:
    content = f.read()

depth = 0
lines = content.split('\n')
for i, line in enumerate(lines):
    start_depth = depth
    opens = line.count('{')
    closes = line.count('}')
    depth += opens - closes
    
    if '@media' in line or '=================' in line:
        print(f"Line {i+1:4d}: start_depth={start_depth:2d}, end_depth={depth:2d} | {line[:60].strip()}")
