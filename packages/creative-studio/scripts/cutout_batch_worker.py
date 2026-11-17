"""Batch character cutouts for the layered composition: one process, one rembg session, many images.

Usage: python cutout_batch_worker.py --model isnet-general-use --out-dir <dir> <image> [<image> ...]
Prints JSON with one output path per input (same order). Uses the rembg models already in ~/.u2net.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="isnet-general-use")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("images", nargs="+")
    args = parser.parse_args()

    from PIL import Image
    from rembg import new_session, remove

    started = time.time()
    session = new_session(args.model)
    load_ms = int((time.time() - started) * 1000)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    outputs = []
    for index, image_path in enumerate(args.images):
        t0 = time.time()
        cutout = remove(Image.open(image_path).convert("RGBA"), session=session)
        out_path = out_dir / f"cutout-{index + 1}.png"
        cutout.save(str(out_path), format="PNG")
        outputs.append({"input": image_path, "output": str(out_path), "durationMs": int((time.time() - t0) * 1000)})
    print(json.dumps({"ok": True, "model": args.model, "loadMs": load_ms, "outputs": outputs}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
