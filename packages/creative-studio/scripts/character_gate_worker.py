"""Character Composition Gate detector worker.

Runs local detectors on generated images and prints raw evidence as JSON. It never decides acceptance: the TypeScript
gate (src/character-gate.ts) combines the evidence. Detectors (all local, loaded from the ComfyUI install):

- yolo_person: Ultralytics person_yolov8m-seg (COCO, photo-trained; weaker on stylized anime).
- yolo_face:   Bingsu face_yolov8m (trained on 2D anime and real faces).
- yolo_hand:   Bingsu hand_yolov8s.
- openpose:    lllyasviel OpenPose body CNN (non-YOLO keypoint model) via comfyui_controlnet_aux.

Usage: python character_gate_worker.py --comfyui-root <dir> --out <json> <image> [<image> ...]
Run it with the ComfyUI venv interpreter (it already has torch/ultralytics and the controlnet_aux sources).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path


def load_models(root: Path, device: str):
    from ultralytics import YOLO

    models = {
        "yolo_person": YOLO(str(root / "models" / "ultralytics" / "segm" / "person_yolov8m-seg.pt")),
        "yolo_face": YOLO(str(root / "models" / "ultralytics" / "bbox" / "face_yolov8m.pt")),
        "yolo_hand": YOLO(str(root / "models" / "ultralytics" / "bbox" / "hand_yolov8s.pt")),
    }
    aux_src = root / "custom_nodes" / "comfyui_controlnet_aux" / "src"
    sys.path.insert(0, str(aux_src))
    from custom_controlnet_aux.open_pose.body import Body  # type: ignore

    body_path = root / "custom_nodes" / "comfyui_controlnet_aux" / "ckpts" / "lllyasviel" / "Annotators" / "body_pose_model.pth"
    body = Body(str(body_path))
    if device == "cuda":
        body.to("cuda")
    models["openpose"] = body
    return models


def yolo_boxes(model, image, conf: float, device: str, with_masks: bool = False):
    result = model.predict(image, conf=conf, device=0 if device == "cuda" else "cpu", verbose=False)[0]
    boxes = []
    names = result.names
    masks = result.masks.data.cpu().numpy() if with_masks and result.masks is not None else None
    for index, box in enumerate(result.boxes):
        cls = int(box.cls.item())
        label = names.get(cls, str(cls)) if isinstance(names, dict) else str(cls)
        if model is not None and "person" in str(getattr(model, "ckpt_path", "")) and label != "person":
            continue
        x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
        entry = {"x": x1, "y": y1, "width": x2 - x1, "height": y2 - y1, "confidence": float(box.conf.item()), "label": label}
        if masks is not None:
            entry["maskArea"] = float(masks[index].mean())
        boxes.append(entry)
    return boxes


def openpose_people(body, image_bgr):
    candidate, subset = body(image_bgr)
    people = []
    for person in subset:
        keypoints = []
        for part in range(18):
            index = int(person[part])
            if index < 0:
                keypoints.append(None)
            else:
                x, y, score = candidate[index][0:3]
                keypoints.append({"x": float(x), "y": float(y), "score": float(score)})
        people.append({"keypoints": keypoints, "score": float(person[18]), "parts": int(person[19])})
    return people


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--comfyui-root", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--min-conf", type=float, default=0.2)
    parser.add_argument("images", nargs="+")
    args = parser.parse_args()

    import cv2
    import torch

    device = args.device if (args.device == "cpu" or torch.cuda.is_available()) else "cpu"
    started = time.time()
    models = load_models(Path(args.comfyui_root), device)
    load_ms = int((time.time() - started) * 1000)
    results = []
    for image_path in args.images:
        t0 = time.time()
        image = cv2.imread(image_path, cv2.IMREAD_COLOR)
        if image is None:
            results.append({"image": image_path, "error": "unreadable image"})
            continue
        height, width = image.shape[:2]
        entry = {"image": image_path, "width": width, "height": height, "detectors": {}}
        for name in ("yolo_person", "yolo_face", "yolo_hand"):
            try:
                entry["detectors"][name] = {"boxes": yolo_boxes(models[name], image, args.min_conf, device, with_masks=name == "yolo_person")}
            except Exception as error:  # noqa: BLE001 - reported per detector, never hidden
                entry["detectors"][name] = {"error": str(error)}
        try:
            entry["detectors"]["openpose"] = {"people": openpose_people(models["openpose"], image)}
        except Exception as error:  # noqa: BLE001
            entry["detectors"]["openpose"] = {"error": str(error)}
        entry["durationMs"] = int((time.time() - t0) * 1000)
        results.append(entry)
    peak = int(torch.cuda.max_memory_allocated() / (1024 * 1024)) if device == "cuda" else 0
    Path(args.out).write_text(json.dumps({"device": device, "loadMs": load_ms, "peakTorchMiB": peak, "results": results}), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
