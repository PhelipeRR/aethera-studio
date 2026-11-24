import json
import os
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

mode = os.environ.get("PADDLEOCR_FIXTURE_MODE", "success")
print(json.dumps({"type": "ready", "model": "fixture", "engineVersion": "fixture"}), flush=True)

for line in sys.stdin:
    if not line.strip():
        continue
    request = json.loads(line)
    if mode == "timeout":
        time.sleep(1.0)
    elif mode == "error":
        print(json.dumps({"type": "error", "id": request.get("id"), "error": "fixture worker error"}), flush=True)
    else:
        print(json.dumps({
            "type": "result",
            "id": request.get("id"),
            "result": {
                "model": "fixture",
                "engineVersion": "fixture",
                "lines": [{"text": "KEUK...!", "confidence": 0.99, "box": [10, 20, 80, 40], "polygon": [[10, 20], [90, 20], [90, 60], [10, 60]]}],
            },
        }), flush=True)
