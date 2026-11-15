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
        # Use raw cosine similarity (logits_per_image / logit_scale) so CLIP never returns an inflated 100% softmax
        logit_scale = model.logit_scale.exp().item() if hasattr(model, "logit_scale") else 100.0
        cos_sims = (outputs.logits_per_image[0] / max(1.0, logit_scale)).detach().cpu().tolist()

    # Typical CLIP cosine similarity for matching text-image pairs is ~0.20..0.34; map [0.14..0.34] -> [0.35..0.94]
    def calibrate_cosine(c: float) -> float:
        return max(0.05, min(0.95, 0.35 + (c - 0.14) * (0.59 / 0.20)))

    cal_scores = [calibrate_cosine(c) for c in cos_sims]
    pos_scores = cal_scores[: len(positives)]
    neg_scores = cal_scores[len(positives) :]
    best_pos_idx = max(range(len(positives)), key=lambda i: pos_scores[i])
    best_neg_idx = max(range(len(negatives)), key=lambda i: neg_scores[i]) if neg_scores else None
    best_pos = float(pos_scores[best_pos_idx])
    best_neg = float(neg_scores[best_neg_idx]) if best_neg_idx is not None else 0.25
    margin = best_pos - best_neg

    print(
        json.dumps(
            {
                "ok": True,
                "mode": "evaluate-semantic",
                "model": model_id,
                "device": device,
                "best_positive": positives[best_pos_idx],
                "best_negative": negatives[best_neg_idx] if best_neg_idx is not None else None,
                "positive_prob": round(best_pos, 4),
                "negative_prob": round(best_neg, 4),
                "margin": round(margin, 4),
                "is_off_topic": best_pos < 0.52 or margin < 0.04,
                "scores": {labels[i]: round(float(cal_scores[i]), 4) for i in range(len(labels))},
            }
        )
    )


def run_inspect_visual_quality(args: argparse.Namespace) -> None:
    import numpy as np
    import torch
    from PIL import Image, ImageFilter
    from transformers import CLIPModel, CLIPProcessor

    device = "cuda" if torch.cuda.is_available() and not args.cpu else "cpu"
    model_id = args.clip_model
    try:
        model = CLIPModel.from_pretrained(model_id, local_files_only=True).to(device)
        processor = CLIPProcessor.from_pretrained(model_id, local_files_only=True)
    except Exception:
        model = CLIPModel.from_pretrained(model_id).to(device)
        processor = CLIPProcessor.from_pretrained(model_id)

    img = Image.open(str(args.image)).convert("RGB")
    w, h = img.size
    genre = (args.genre or "general").lower()

    # Spatial regions: center hero, left-mid, right-mid, lower-center (where hands/weapons/objects sit)
    regions = [
        ("center_focal", int(w * 0.20), int(h * 0.12), int(w * 0.60), int(h * 0.72)),
        ("left_limb_joint", int(w * 0.05), int(h * 0.18), int(w * 0.42), int(h * 0.68)),
        ("right_limb_joint", int(w * 0.53), int(h * 0.18), int(w * 0.42), int(h * 0.68)),
        ("lower_grip_zone", int(w * 0.18), int(h * 0.45), int(w * 0.64), int(h * 0.50)),
    ]

    clean_probes = (
        [
            "clean stylized anime illustration with coherent proportions and sharp linework",
            "well-composed anime visual scene with clear focal silhouette",
        ]
        if genre == "anime"
        else [
            "coherent well-structured mechanical hardware device with clean geometry and solid joints",
            "sharp well-proportioned anatomy and physically plausible object attachment",
        ]
    )
    defect_probes = [
        ("extra_fingers", "deformed mutated hand with extra fingers, fused fingers, or mangled digits"),
        ("impossible_joint", "broken twisted anatomical joint or disconnected floating limb"),
        ("object_clipping_hand", "weapon or object clipping through palm or fusing into distorted fingers"),
        ("implausible_mech_joint", "chaotic tangled wires and asymmetrical melted mechanical joints"),
    ]
    probe_texts = clean_probes + [d[1] for d in defect_probes]

    crops = [img.crop((rx, ry, rx + rw, ry + rh)) for (_, rx, ry, rw, rh) in regions]
    inputs = processor(text=probe_texts, images=crops, return_tensors="pt", padding=True, truncation=True).to(device)
    with torch.no_grad():
        outputs = model(**inputs)
        probs = outputs.logits_per_image.softmax(dim=1).detach().cpu().numpy()

    localized_defects = []
    patch_clean_scores = []
    patch_artifact_scores = []

    for idx, (rname, rx, ry, rw, rh) in enumerate(regions):
        p = probs[idx]
        clean_score = float(np.sum(p[: len(clean_probes)]))
        defect_probs = p[len(clean_probes) :]
        worst_idx = int(np.argmax(defect_probs))
        worst_prob = float(defect_probs[worst_idx])
        d_cat, d_desc = defect_probes[worst_idx]
        patch_clean_scores.append(clean_score)
        patch_artifact_scores.append(worst_prob)

        if worst_prob > clean_score + 0.08 or worst_prob >= 0.46:
            sev = "severe" if worst_prob >= 0.58 else "moderate" if worst_prob >= 0.46 else "minor"
            localized_defects.append(
                {
                    "id": f"defect-{rname}-{d_cat}",
                    "category": d_cat,
                    "severity": sev,
                    "bbox": {"x": rx, "y": ry, "width": rw, "height": rh},
                    "description": f"Região {rname}: {d_desc} (confiança={worst_prob:.2f} vs limpo={clean_score:.2f})",
                    "repaired": False,
                }
            )

    mean_clean = float(np.mean(patch_clean_scores))
    max_defect = float(np.max(patch_artifact_scores))
    anatomical_consistency = int(round(max(20.0, min(96.0, mean_clean * 100.0 - max_defect * 22.0))))
    physical_coherence = int(round(max(25.0, min(95.0, (1.0 - max_defect * 0.85) * 94.0))))
    artifact_severity = int(round(max(4.0, min(95.0, max_defect * 100.0))))

    # Composition quality from center-vs-border edge focus
    edges = np.asarray(img.convert("L").filter(ImageFilter.FIND_EDGES), dtype=np.float32)
    center_edge = float(np.mean(edges[int(h * 0.15) : int(h * 0.85), int(w * 0.18) : int(w * 0.82)]))
    global_edge = float(np.mean(edges)) + 1e-5
    focus_ratio = min(1.35, center_edge / global_edge)
    composition_quality = int(round(max(55.0, min(95.0, 62.0 + focus_ratio * 22.0))))

    # Subject identity consistency (when comparing before vs after image)
    subject_identity_consistency = 92
    if args.compare_image and Path(args.compare_image).exists():
        comp_img = Image.open(str(args.compare_image)).convert("L").resize((256, 256), Image.Resampling.BILINEAR)
        base_img = img.convert("L").resize((256, 256), Image.Resampling.BILINEAR)
        a_edge = np.asarray(base_img.filter(ImageFilter.FIND_EDGES), dtype=np.float32)
        b_edge = np.asarray(comp_img.filter(ImageFilter.FIND_EDGES), dtype=np.float32)
        a_norm = a_edge - float(np.mean(a_edge))
        b_norm = b_edge - float(np.mean(b_edge))
        denom = float(np.linalg.norm(a_norm) * np.linalg.norm(b_norm)) + 1e-5
        edge_corr = max(0.0, float(np.sum(a_norm * b_norm)) / denom)
        # Also compute CLIP image-to-image embedding cosine similarity
        pair_in = processor(images=[img, Image.open(str(args.compare_image)).convert("RGB")], return_tensors="pt").to(device)
        with torch.no_grad():
            img_feats = model.get_image_features(**pair_in)
            img_feats = img_feats / img_feats.norm(dim=-1, keepdim=True)
            clip_img_sim = float((img_feats[0] @ img_feats[1]).item())
        subject_identity_consistency = int(
            round(max(15.0, min(98.0, edge_corr * 45.0 + max(0.0, clip_img_sim) * 55.0)))
        )
        if subject_identity_consistency < 72:
            localized_defects.append(
                {
                    "id": "defect-identity-mismatch",
                    "category": "identity_mismatch",
                    "severity": "severe",
                    "bbox": {"x": int(w * 0.5), "y": 0, "width": int(w * 0.5), "height": h},
                    "description": f"Inconsistência estrutural entre antes e depois (identidade={subject_identity_consistency}/100, edgeCorr={edge_corr:.2f}, clipSim={clip_img_sim:.2f}).",
                    "repaired": False,
                }
            )

    print(
        json.dumps(
            {
                "ok": True,
                "mode": "inspect-visual-quality",
                "model": model_id,
                "device": device,
                "anatomical_consistency": anatomical_consistency,
                "physical_coherence": physical_coherence,
                "composition_quality": composition_quality,
                "subject_identity_consistency": subject_identity_consistency,
                "visual_artifact_severity": artifact_severity,
                "localized_defects": localized_defects,
            }
        )
    )


def run_inpaint_region(args: argparse.Namespace) -> None:
    import torch
    from diffusers import AutoPipelineForImage2Image
    from PIL import Image, ImageDraw, ImageFilter

    device = "cuda" if torch.cuda.is_available() and not args.cpu else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    load_kwargs = {"torch_dtype": dtype, "local_files_only": True}
    if device == "cuda":
        load_kwargs["variant"] = "fp16"

    try:
        pipe = AutoPipelineForImage2Image.from_pretrained(args.model, **load_kwargs)
    except Exception:
        load_kwargs.pop("local_files_only", None)
        pipe = AutoPipelineForImage2Image.from_pretrained(args.model, **load_kwargs)

    if device == "cuda":
        pipe.enable_attention_slicing()
        pipe.enable_vae_tiling()
        try:
            pipe.enable_model_cpu_offload()
        except Exception:
            pipe = pipe.to("cuda")
    else:
        pipe = pipe.to("cpu")

    base = Image.open(str(args.image)).convert("RGB")
    w, h = base.size
    parts = [int(float(v)) for v in args.bbox.split(",")]
    bx, by, bw, bh = parts[0], parts[1], parts[2], parts[3]
    bx = max(0, min(w - 32, bx))
    by = max(0, min(h - 32, by))
    bw = max(32, min(w - bx, bw))
    bh = max(32, min(h - by, bh))

    crop_w = max(256, min(768, (bw // 8) * 8))
    crop_h = max(256, min(768, (bh // 8) * 8))
    patch = base.crop((bx, by, bx + bw, by + bh)).resize((crop_w, crop_h), Image.Resampling.LANCZOS)

    strength = max(0.35, min(0.75, float(args.strength)))
    steps = max(4, int(round(4 / strength)))
    repaired_patch = pipe(
        prompt=args.prompt,
        image=patch,
        strength=strength,
        num_inference_steps=steps,
        guidance_scale=0.0,
    ).images[0].resize((bw, bh), Image.Resampling.LANCZOS)

    # Feathered mask so only the defective bbox is seamlessly blended
    mask = Image.new("L", (bw, bh), 0)
    draw = ImageDraw.Draw(mask)
    pad = max(6, min(bw, bh) // 10)
    draw.rectangle([pad, pad, bw - pad, bh - pad], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=max(4, pad // 2)))

    out_img = base.copy()
    out_img.paste(repaired_patch, (bx, by), mask)
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_img.save(str(out_path), format="PNG")

    print(
        json.dumps(
            {
                "ok": True,
                "mode": "inpaint-region",
                "bbox": [bx, by, bw, bh],
                "output": str(out_path),
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

    insp_qual = sub.add_parser("inspect-visual-quality")
    insp_qual.add_argument("--image", required=True)
    insp_qual.add_argument("--compare-image", default=None)
    insp_qual.add_argument("--genre", default="general")
    insp_qual.add_argument("--clip-model", default="openai/clip-vit-base-patch32")
    insp_qual.add_argument("--cpu", action="store_true")

    inpaint = sub.add_parser("inpaint-region")
    inpaint.add_argument("--image", required=True)
    inpaint.add_argument("--output", required=True)
    inpaint.add_argument("--prompt", required=True)
    inpaint.add_argument("--bbox", required=True)
    inpaint.add_argument("--strength", type=float, default=0.52)
    inpaint.add_argument("--model", default="stabilityai/sdxl-turbo")
    inpaint.add_argument("--cpu", action="store_true")

    args = parser.parse_args()
    if args.command == "generate":
        run_generate(args)
    elif args.command == "segment":
        run_segment(args)
    elif args.command == "segment-adaptive":
        run_segment_adaptive(args)
    elif args.command == "evaluate-semantic":
        run_evaluate_semantic(args)
    elif args.command == "inspect-visual-quality":
        run_inspect_visual_quality(args)
    elif args.command == "inpaint-region":
        run_inpaint_region(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
