"""Local PaddleOCR worker for Aethera Recap.

The process is intentionally line-oriented and keeps stdout machine-readable.
Diagnostics stay on stderr. It uses one CPU worker and disables oneDNN because
the installed PaddlePaddle/PaddleX combination fails in that execution path
on the target Windows environment.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("FLAGS_use_mkldnn", "0")
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def emit(value: dict) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def safe_error(error: object) -> str:
    return " ".join(str(error).split())[:600]


def to_points(value: object) -> list[list[float]]:
    if not isinstance(value, (list, tuple)):
        return []
    points: list[list[float]] = []
    for point in value:
        if isinstance(point, (list, tuple)) and len(point) >= 2:
            try:
                points.append([float(point[0]), float(point[1])])
            except (TypeError, ValueError):
                continue
    return points


def offset_points(points: list[list[float]], x: int, y: int) -> list[list[float]]:
    return [[point[0] + x, point[1] + y] for point in points]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="PP-OCRv6_medium_det+rec")
    parser.add_argument("--lang", default="en")
    args = parser.parse_args()

    try:
        import numpy as np
        import paddle
        from PIL import Image
        from paddleocr import PaddleOCR

        ocr = PaddleOCR(
            lang=args.lang,
            device="cpu",
            enable_mkldnn=False,
            cpu_threads=1,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            return_word_box=True,
        )
        engine_version = getattr(paddle, "__version__", None)
        emit({"type": "ready", "model": args.model, "engineVersion": engine_version})
    except Exception as error:  # pragma: no cover - exercised by environment validation
        emit({"type": "error", "error": f"PaddleOCR worker initialization failed: {safe_error(error)}"})
        return 1

    for line in sys.stdin:
        if not line.strip():
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            image_path = Path(request["imagePath"])
            region = request.get("region")
            x_offset = 0
            y_offset = 0
            with Image.open(image_path) as image:
                image = image.convert("RGB")
                if isinstance(region, dict):
                    x_offset = int(region.get("x", 0))
                    y_offset = int(region.get("y", 0))
                    x_end = x_offset + int(region.get("w", 0))
                    y_end = y_offset + int(region.get("h", 0))
                    if x_end <= x_offset or y_end <= y_offset:
                        raise ValueError("OCR region has non-positive dimensions.")
                    image = image.crop((x_offset, y_offset, x_end, y_end))
                started = time.perf_counter()
                output = list(ocr.predict(np.asarray(image)))
                elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
            raw = output[0].json if output else {"res": {}}
            data = raw.get("res", raw) if isinstance(raw, dict) else {}
            texts = data.get("rec_texts", []) if isinstance(data, dict) else []
            scores = data.get("rec_scores", []) if isinstance(data, dict) else []
            boxes = data.get("rec_boxes", []) if isinstance(data, dict) else []
            polygons = data.get("rec_polys", []) if isinstance(data, dict) else []
            lines = []
            for index, text in enumerate(texts):
                text_value = str(text or "").strip()
                box = boxes[index] if index < len(boxes) else []
                polygon = to_points(polygons[index] if index < len(polygons) else [])
                if not text_value or not isinstance(box, (list, tuple)) or len(box) < 4:
                    continue
                adjusted_box = [float(box[0]) + x_offset, float(box[1]) + y_offset, float(box[2]) + x_offset, float(box[3]) + y_offset]
                lines.append({
                    "text": text_value,
                    "confidence": float(scores[index]) if index < len(scores) and scores[index] is not None else None,
                    "box": adjusted_box,
                    "polygon": offset_points(polygon, x_offset, y_offset),
                })
            emit({"type": "result", "id": request_id, "result": {"lines": lines, "model": args.model, "engineVersion": engine_version, "processingMs": elapsed_ms}})
        except Exception as error:
            emit({"type": "error", "id": request_id, "error": safe_error(error)})

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
