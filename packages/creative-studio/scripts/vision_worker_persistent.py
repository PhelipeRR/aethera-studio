#!/usr/bin/env python3
"""
Aethera Creative Studio — Persistent AI Vision Worker

Unlike vision_worker.py (which spawns a new process per request and reloads
models from scratch each time), this worker stays resident in memory and
accepts commands via stdin/stdout JSON protocol. This eliminates the ~15s
model loading overhead per generation and prevents VRAM fragmentation
from repeated load/unload cycles on 8 GB GPUs.

Protocol: one JSON object per line on stdin, one JSON response per line on stdout.
Commands: generate, evaluate-semantic, inspect-visual-quality, segment-adaptive, inpaint-region, shutdown
"""
import json
import sys
import traceback
from pathlib import Path
from typing import Any


class PersistentWorker:
    """Holds models in memory and processes commands without reloading."""

    def __init__(self):
        self._sdxl_pipe = None
        self._sdxl_model_id: str | None = None
        self._clip_model = None
        self._clip_processor = None
        self._clip_model_id: str | None = None
        self._device: str | None = None
        self._dtype = None

    def _ensure_device(self):
        if self._device is not None:
            return
        import torch
        self._device = "cuda" if torch.cuda.is_available() else "cpu"
        self._dtype = torch.float16 if self._device == "cuda" else torch.float32

    def _get_sdxl_pipe(self, model_id: str):
        """Reuse existing pipeline if same model, otherwise load new one."""
        if self._sdxl_pipe is not None and self._sdxl_model_id == model_id:
            return self._sdxl_pipe

        import torch
        from diffusers import AutoPipelineForText2Image

        self._ensure_device()
        load_kwargs = {"torch_dtype": self._dtype, "local_files_only": True}
        if self._device == "cuda":
            load_kwargs["variant"] = "fp16"

        try:
            pipe = AutoPipelineForText2Image.from_pretrained(model_id, **load_kwargs)
        except Exception:
            load_kwargs.pop("local_files_only", None)
            pipe = AutoPipelineForText2Image.from_pretrained(model_id, **load_kwargs)

        if self._device == "cuda":
            pipe.enable_attention_slicing()
            try:
                pipe.vae.enable_tiling()
            except Exception:
                pass
            try:
                pipe.enable_model_cpu_offload()
            except Exception:
                pipe = pipe.to("cuda")
        else:
            pipe = pipe.to("cpu")

        # Unload previous model if switching
        if self._sdxl_pipe is not None and self._device == "cuda":
            del self._sdxl_pipe
            torch.cuda.empty_cache()

        self._sdxl_pipe = pipe
        self._sdxl_model_id = model_id
        return pipe

    def _get_clip(self, model_id: str):
        """Reuse existing CLIP model if same id, otherwise load new one."""
        if self._clip_model is not None and self._clip_model_id == model_id:
            return self._clip_model, self._clip_processor

        import torch
        from transformers import CLIPModel, CLIPProcessor

        self._ensure_device()
        try:
            model = CLIPModel.from_pretrained(model_id, local_files_only=True).to(self._device)
            processor = CLIPProcessor.from_pretrained(model_id, local_files_only=True)
        except Exception:
            model = CLIPModel.from_pretrained(model_id).to(self._device)
            processor = CLIPProcessor.from_pretrained(model_id)

        # Unload previous
        if self._clip_model is not None and self._device == "cuda":
            del self._clip_model
            del self._clip_processor
            torch.cuda.empty_cache()

        self._clip_model = model
        self._clip_processor = processor
        self._clip_model_id = model_id
        return model, processor

    def handle_generate(self, args: dict) -> dict:
        import torch
        from PIL import Image

        model_id = args.get("model", "stabilityai/sdxl-turbo")
        pipe = self._get_sdxl_pipe(model_id)

        prompt = args["prompt"]
        width = int(args.get("width", 768))
        height = int(args.get("height", 512))
        steps = int(args.get("steps", 4))
        seed = args.get("seed")
        output = args["output"]

        generator = None
        if seed is not None:
            generator = torch.Generator(device="cpu").manual_seed(int(seed))

        result = pipe(
            prompt=prompt,
            width=width,
            height=height,
            num_inference_steps=steps,
            guidance_scale=0.0,
            generator=generator,
        )
        image = result.images[0]
        out_path = Path(output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        image.save(str(out_path), format="PNG")

        return {
            "ok": True,
            "mode": "generate",
            "model": model_id,
            "device": self._device,
            "width": image.width,
            "height": image.height,
            "output": str(out_path),
        }

    def handle_evaluate_semantic(self, args: dict) -> dict:
        import torch
        from PIL import Image

        model_id = args.get("clip_model", "openai/clip-vit-base-patch32")
        model, processor = self._get_clip(model_id)

        image = Image.open(args["image"]).convert("RGB")
        positives = [p.strip() for p in args["positives"].split("|") if p.strip()]
        negatives = [n.strip() for n in args["negatives"].split("|") if n.strip()]
        labels = positives + negatives

        if not positives or not labels:
            raise ValueError("At least one positive label required.")

        inputs = processor(text=labels, images=image, return_tensors="pt", padding=True, truncation=True).to(self._device)
        with torch.no_grad():
            outputs = model(**inputs)
            logit_scale = model.logit_scale.exp().item() if hasattr(model, "logit_scale") else 100.0
            cos_sims = (outputs.logits_per_image[0] / max(1.0, logit_scale)).detach().cpu().tolist()

        def calibrate_cosine(c: float) -> float:
            return max(0.05, min(0.95, 0.35 + (c - 0.14) * (0.59 / 0.20)))

        cal_scores = [calibrate_cosine(c) for c in cos_sims]
        pos_scores = cal_scores[: len(positives)]
        neg_scores = cal_scores[len(positives):]
        best_pos_idx = max(range(len(positives)), key=lambda i: pos_scores[i])
        best_neg_idx = max(range(len(negatives)), key=lambda i: neg_scores[i]) if neg_scores else None
        best_pos = float(pos_scores[best_pos_idx])
        best_neg = float(neg_scores[best_neg_idx]) if best_neg_idx is not None else 0.25
        margin = best_pos - best_neg

        return {
            "ok": True,
            "mode": "evaluate-semantic",
            "model": model_id,
            "device": self._device,
            "best_positive": positives[best_pos_idx],
            "best_negative": negatives[best_neg_idx] if best_neg_idx is not None else None,
            "positive_prob": round(best_pos, 4),
            "negative_prob": round(best_neg, 4),
            "margin": round(margin, 4),
            "is_off_topic": best_pos < 0.52 or margin < 0.04,
            "scores": {labels[i]: round(float(cal_scores[i]), 4) for i in range(len(labels))},
        }

    def handle_shutdown(self, args: dict) -> dict:
        import torch
        if self._device == "cuda":
            if self._sdxl_pipe is not None:
                del self._sdxl_pipe
            if self._clip_model is not None:
                del self._clip_model
            torch.cuda.empty_cache()
        return {"ok": True, "mode": "shutdown"}

    def process_command(self, cmd: dict) -> dict:
        mode = cmd.get("command", "")
        try:
            if mode == "generate":
                return self.handle_generate(cmd)
            elif mode == "evaluate-semantic":
                return self.handle_evaluate_semantic(cmd)
            elif mode == "shutdown":
                return self.handle_shutdown(cmd)
            else:
                return {"ok": False, "error": f"Unknown command: {mode}"}
        except Exception as e:
            return {
                "ok": False,
                "error": str(e),
                "traceback": traceback.format_exc(),
                "command": mode,
            }


def main():
    worker = PersistentWorker()
    # Signal readiness
    print(json.dumps({"ready": True}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError as e:
            print(json.dumps({"ok": False, "error": f"Invalid JSON: {e}"}), flush=True)
            continue

        result = worker.process_command(cmd)
        print(json.dumps(result), flush=True)

        if cmd.get("command") == "shutdown":
            break


if __name__ == "__main__":
    main()