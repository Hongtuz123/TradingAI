import sys

def filter_file(filepath, kw_list):
    print(f"=== Filtering {filepath} ===")
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line_lower = line.lower()
            if any(kw in line_lower for kw in kw_list):
                print(line.strip())

if __name__ == "__main__":
    kws = ["財務", "比率", "分析", "營收", "毛利", "負債", "eps", "roe", "t187ap05", "t187ap14", "t187ap17", "t187ap18"]
    filter_file("scratch/twse_endpoints.txt", kws)
    print()
    filter_file("scratch/tpex_endpoints.txt", kws)
