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
    from diffusers import AutoPipelineForText2Image

    device = "cuda" if torch.cuda.is_available() and not args.cpu else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32

    load_kwargs = {"torch_dtype": dtype, "local_files_only": True}
    if device == "cuda":
        load_kwargs["variant"] = "fp16"

    try:
        pipe = AutoPipelineForText2Image.from_pretrained(args.model, **load_kwargs)
    except Exception:
        load_kwargs.pop("local_files_only", None)
        pipe = AutoPipelineForText2Image.from_pretrained(args.model, **load_kwargs)

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
    gen.add_argument("--cpu", action="store_true")

    seg = sub.add_parser("segment")
    seg.add_argument("--input", required=True)
    seg.add_argument("--output", required=True)
    seg.add_argument("--rembg-model", default="u2net")
    seg.add_argument("--alpha-matting", action="store_true")

    args = parser.parse_args()
    if args.command == "generate":
        run_generate(args)
    elif args.command == "segment":
        run_segment(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
