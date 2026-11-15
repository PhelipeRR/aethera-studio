#!/usr/bin/env python3
"""
Aethera Creative Studio — Local AI Vision Worker
1) generate: Text-to-Image via Diffusers (SDXL-Turbo) on CUDA RTX 4060 Ti (with CPU fallback)
2) segment: Semantic Background Removal via rembg (U2Net/ISNet alpha matting)
"""
import argparse
import json
import sys
from pathlib import Path


def run_generate(args: argparse.Namespace) -> None:
    import torch
    from diffusers import AutoPipelineForImage2Image, AutoPipelineForText2Image
    from PIL import Image

    device = "cuda" if torch.cuda.is_available() and not args.cpu else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32

    load_kwargs = {"torch_dtype": dtype, "local_files_only": True}
    if device == "cuda":
        load_kwargs["variant"] = "fp16"

    use_img2img = bool(args.init_image)
    pipeline_cls = AutoPipelineForImage2Image if use_img2img else AutoPipelineForText2Image

    try:
        pipe = pipeline_cls.from_pretrained(args.model, **load_kwargs)
    except Exception:
        load_kwargs.pop("local_files_only", None)
        pipe = pipeline_cls.from_pretrained(args.model, **load_kwargs)

    if device == "cuda":
        # Memory-efficient options for 8 GB VRAM (especially when other apps share VRAM)
        pipe.enable_attention_slicing()
        pipe.enable_vae_tiling()
        try:
            pipe.enable_model_cpu_offload()
        except Exception:
            pipe = pipe.to("cuda")
    else:
        pipe = pipe.to("cpu")

    generator = None
    if args.seed is not None:
        generator = torch.Generator(device="cpu").manual_seed(args.seed)

    if use_img2img:
        init_img = Image.open(args.init_image).convert("RGB").resize((args.width, args.height), Image.Resampling.LANCZOS)
        strength = max(0.25, min(0.95, float(args.strength)))
        # SDXL-Turbo needs int(steps * strength) >= 2 for visible transformation
        effective_steps = max(4, int(round(max(args.steps, 4) / strength)))
        result = pipe(
            prompt=args.prompt,
            image=init_img,
            strength=strength,
            num_inference_steps=effective_steps,
            guidance_scale=0.0,
            generator=generator,
        )
    else:
        result = pipe(
            prompt=args.prompt,
            width=args.width,
            height=args.height,
            num_inference_steps=args.steps,
            guidance_scale=0.0,
            generator=generator,
        )
    image = result.images[0]
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(str(out_path), format="PNG")

    print(
        json.dumps(
            {
                "ok": True,
                "mode": "generate",
                "model": args.model,
                "device": device,
                "width": image.width,
                "height": image.height,
                "output": str(out_path),
            }
        )
    )


def run_segment(args: argparse.Namespace) -> None:
    from PIL import Image
    from rembg import new_session, remove

    in_path = Path(args.input)
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    img = Image.open(str(in_path)).convert("RGBA")
    session = new_session(args.rembg_model)
    cutout = remove(
        img,
        session=session,
        alpha_matting=args.alpha_matting,
        alpha_matting_foreground_threshold=240,
        alpha_matting_background_threshold=10,
        alpha_matting_erode_size=6,
    )
    cutout.save(str(out_path), format="PNG")

    print(
        json.dumps(
            {
                "ok": True,
                "mode": "segment",
                "model": args.rembg_model,
                "alpha_matting": args.alpha_matting,
                "width": cutout.width,
                "height": cutout.height,
                "output": str(out_path),
            }
        )
    )


def score_cutout_mask(cutout_image) -> dict:
    import numpy as np

    rgba = np.array(cutout_image.convert("RGBA"))
    alpha = rgba[:, :, 3].astype(np.float32) / 255.0
    h, w = alpha.shape
    total = float(h * w) if h * w > 0 else 1.0

    fg_mask = alpha >= 0.5
    fg_ratio = float(np.sum(fg_mask)) / total

    # Band of semi-transparent edge pixels (0.05..0.95): some anti-aliasing is good,
    # excessive muddy semi-transparency hurts crispness.
    mid_ratio = float(np.sum((alpha > 0.05) & (alpha < 0.95))) / total
    solid_fg = float(np.sum(alpha >= 0.90)) / max(1.0, float(np.sum(alpha > 0.10)))

    # Top-quarter detail retention (hair, headgear, antennas)
    top_q = alpha[: max(1, h // 4), :]
    top_fg_ratio = float(np.sum(top_q >= 0.4)) / max(1.0, float(top_q.size))

    # Edge gradient sharpness along boundary
    gx = np.abs(np.diff(alpha, axis=1))
    gy = np.abs(np.diff(alpha, axis=0))
    boundary_sharpness = float(
        np.mean(gx[gx > 0.08]) if np.any(gx > 0.08) else 0.0
    ) * 0.5 + float(
        np.mean(gy[gy > 0.08]) if np.any(gy > 0.08) else 0.0
    ) * 0.5

    # Coverage fitness: healthy subject occupies 10% - 75% of canvas
    if fg_ratio < 0.05 or fg_ratio > 0.92:
        coverage_score = 0.1
    elif 0.12 <= fg_ratio <= 0.72:
        coverage_score = 1.0
    else:
        coverage_score = 0.65

    # Penalize excessive muddy alpha band (>6% of whole image)
    cleanliness_score = max(0.0, 1.0 - max(0.0, mid_ratio - 0.03) * 8.0)

    total_score = (
        coverage_score * 0.35
        + solid_fg * 0.25
        + min(1.0, boundary_sharpness * 2.2) * 0.20
        + cleanliness_score * 0.12
        + min(1.0, top_fg_ratio * 4.0) * 0.08
    )

    return {
        "score": round(total_score, 4),
        "fg_ratio": round(fg_ratio, 4),
        "solid_fg": round(solid_fg, 4),
        "mid_ratio": round(mid_ratio, 4),
        "top_fg_ratio": round(top_fg_ratio, 4),
        "boundary_sharpness": round(boundary_sharpness, 4),
    }


def run_segment_adaptive(args: argparse.Namespace) -> None:
    from PIL import Image
    from rembg import new_session, remove

    in_path = Path(args.input)
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    img = Image.open(str(in_path)).convert("RGBA")
    models = [m.strip() for m in args.models.split(",") if m.strip()]
    if not models:
        models = ["birefnet-portrait", "isnet-general-use"]

    best_model = models[0]
    best_cutout = None
    best_metrics = {"score": -1.0}
    evaluations = {}

    for model_name in models:
        try:
            session = new_session(model_name)
            cutout = remove(
                img,
                session=session,
                alpha_matting=args.alpha_matting,
                alpha_matting_foreground_threshold=240,
                alpha_matting_background_threshold=10,
                alpha_matting_erode_size=6,
            )
            metrics = score_cutout_mask(cutout)
            evaluations[model_name] = metrics
            if metrics["score"] > best_metrics["score"]:
                best_metrics = metrics
                best_model = model_name
                best_cutout = cutout
        except Exception as exc:
            evaluations[model_name] = {"error": str(exc), "score": -1.0}

    if best_cutout is None:
        raise RuntimeError(f"All adaptive segmentation models failed: {evaluations}")

    best_cutout.save(str(out_path), format="PNG")
    print(
        json.dumps(
            {
                "ok": True,
                "mode": "segment-adaptive",
                "selected_model": best_model,
                "evaluations": evaluations,
                "width": best_cutout.width,
                "height": best_cutout.height,
                "output": str(out_path),
            }
        )
    )


def run_evaluate_semantic(args: argparse.Namespace) -> None:
    import torch
    from PIL import Image
    from transformers import CLIPModel, CLIPProcessor

    device = "cuda" if torch.cuda.is_available() and not args.cpu else "cpu"
    model_id = args.clip_model
    try:
        model = CLIPModel.from_pretrained(model_id, local_files_only=True).to(device)
        processor = CLIPProcessor.from_pretrained(model_id, local_files_only=True)
    except Exception:
        model = CLIPModel.from_pretrained(model_id).to(device)
        processor = CLIPProcessor.from_pretrained(model_id)

    positives = [p.strip() for p in args.positives.split("|") if p.strip()]
    negatives = [n.strip() for n in args.negatives.split("|") if n.strip()]
    labels = positives + negatives
    if not positives or not labels:
        raise ValueError("At least one positive label is required for semantic evaluation.")

    image = Image.open(str(args.image)).convert("RGB")
    inputs = processor(text=labels, images=image, return_tensors="pt", padding=True, truncation=True).to(device)
    with torch.no_grad():
        outputs = model(**inputs)
        probs = outputs.logits_per_image.softmax(dim=1)[0].detach().cpu().tolist()

    pos_probs = probs[: len(positives)]
    neg_probs = probs[len(positives) :]
    pos_sum = float(sum(pos_probs))
    neg_sum = float(sum(neg_probs))
    best_pos_idx = max(range(len(positives)), key=lambda i: pos_probs[i])
    best_neg_idx = max(range(len(negatives)), key=lambda i: neg_probs[i]) if neg_probs else None

    print(
        json.dumps(
            {
                "ok": True,
                "mode": "evaluate-semantic",
                "model": model_id,
                "device": device,
                "best_positive": positives[best_pos_idx],
                "best_negative": negatives[best_neg_idx] if best_neg_idx is not None else None,
                "positive_prob": round(pos_sum, 4),
                "negative_prob": round(neg_sum, 4),
                "margin": round(pos_sum - neg_sum, 4),
                "is_off_topic": pos_sum < 0.48 or neg_sum > pos_sum,
                "scores": {labels[i]: round(float(probs[i]), 4) for i in range(len(labels))},
            }
        )
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Aethera Creative Studio Local Vision Worker")
    sub = parser.add_subparsers(dest="command", required=True)

    gen = sub.add_parser("generate")
    gen.add_argument("--prompt", required=True)
    gen.add_argument("--output", required=True)
    gen.add_argument("--width", type=int, default=768)
    gen.add_argument("--height", type=int, default=512)
    gen.add_argument("--steps", type=int, default=3)
    gen.add_argument("--seed", type=int, default=None)
    gen.add_argument("--model", default="stabilityai/sdxl-turbo")
    gen.add_argument("--init-image", default=None)
    gen.add_argument("--strength", type=float, default=0.55)
    gen.add_argument("--cpu", action="store_true")

    seg = sub.add_parser("segment")
    seg.add_argument("--input", required=True)
    seg.add_argument("--output", required=True)
    seg.add_argument("--rembg-model", default="u2net")
    seg.add_argument("--alpha-matting", action="store_true")

    seg_adapt = sub.add_parser("segment-adaptive")
    seg_adapt.add_argument("--input", required=True)
    seg_adapt.add_argument("--output", required=True)
    seg_adapt.add_argument("--models", default="birefnet-portrait,isnet-general-use")
    seg_adapt.add_argument("--alpha-matting", action="store_true")

    eval_sem = sub.add_parser("evaluate-semantic")
    eval_sem.add_argument("--image", required=True)
    eval_sem.add_argument("--positives", required=True)
    eval_sem.add_argument("--negatives", required=True)
    eval_sem.add_argument("--clip-model", default="openai/clip-vit-base-patch32")
    eval_sem.add_argument("--cpu", action="store_true")

    args = parser.parse_args()
    if args.command == "generate":
        run_generate(args)
    elif args.command == "segment":
        run_segment(args)
    elif args.command == "segment-adaptive":
        run_segment_adaptive(args)
    elif args.command == "evaluate-semantic":
        run_evaluate_semantic(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
