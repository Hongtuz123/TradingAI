import sys
import json
from pathlib import Path

# 將專案根目錄加入 path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.push_notifier import register_new_subscription, load_subscriptions


def main():
    if len(sys.argv) < 2:
        print("💡 使用方式: python backend/register_subscription.py '<推播門牌 JSON>'")
        subs = load_subscriptions()
        print(f"目前已登記設備數: {len(subs)}")
        for idx, s in enumerate(subs, 1):
            print(f"  {idx}. {s.get('endpoint', '')[:50]}...")
        return

    raw = sys.argv[1].strip()
    try:
        sub_data = json.loads(raw)
        ok = register_new_subscription(sub_data)
        if ok:
            print("🎉 成功登記推播裝置！")
        else:
            print("❌ 登記失敗，請確認 JSON 是否包含 endpoint 與 keys。")
    except Exception as e:
        print(f"❌ JSON 解析錯誤: {e}")


if __name__ == "__main__":
    main()
