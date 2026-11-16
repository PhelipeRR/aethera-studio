# ComfyUI image engine audit

Audit date: 2026-11-16. Host: Windows, RTX 4060 Ti 8 GB. Command:

```powershell
npx tsx scripts/comfyui-audit.ts
```

The six-case harness is:

```powershell
npx tsx scripts/comfyui-acceptance.ts
npx tsx scripts/comfyui-acceptance.ts --reference C:\path\to\reference.png
```

When the runtime is offline or has no checkpoint, the harness exits as blocked and prints the exact discovery result. When it is ready, it writes per-case PNGs and `artifacts/comfyui-acceptance/report.json` with duration, VRAM samples, image dimensions and the structural audit.

## Evidence from this machine

The audit found:

- installation: `C:\Users\Pheli\AppData\Local\Programs\ComfyUI`;
- ComfyUI version: `0.20.1` from `resources\ComfyUI\comfyui_version.py`;
- loopback ports `8188` and `8000`: not reachable (`fetch failed` / connection refused);
- no ComfyUI process was running;
- model directories exist, but the audited model extensions are absent from `checkpoints`, `controlnet`, `diffusion_models`, `loras`, `vae`, `upscale_models` and `embeddings`;
- GPU evidence from the baseline: `NVIDIA GeForce RTX 4060 Ti`, 8188 MiB total VRAM, driver `621.01`.

The reproducible result is therefore:

```json
{
  "state": "offline",
  "version": "0.20.1",
  "models": {
    "checkpoints": [],
    "controlnet": [],
    "diffusion_models": [],
    "loras": [],
    "vae": [],
    "upscale_models": [],
    "embeddings": []
  },
  "capabilities": {
    "nativeTxt2Img": false,
    "nativeImg2Img": false,
    "controlNet": false,
    "ipAdapter": false,
    "faceDetailer": false,
    "upscale": false,
    "lora": false
  }
}
```

This is an environment blocker, not a workflow-quality result. No model was downloaded, no external endpoint was enabled, and no ComfyUI process was started automatically.

## Model decision

No model is installed locally, so these are recommendations rather than validated assets:

- quality baseline: [Stable Diffusion XL base 1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0), standalone-capable and the common SDXL reference checkpoint;
- fast preview candidate: [SDXL-Lightning](https://huggingface.co/ByteDance/SDXL-Lightning), whose model card provides 1/2/4/8-step variants; prefer the 4-step variant only after its ComfyUI graph and license are checked;
- existing local fallback: [SDXL-Turbo](https://huggingface.co/stabilityai/sdxl-turbo), suitable for quick previews but its card points commercial users to Stability’s license, so it is not treated as the professional-quality baseline;
- later identity-control candidate: [IP-Adapter for SDXL](https://huggingface.co/h94/IP-Adapter), especially the Plus/Face variants; its SDXL image encoder footprint is substantial for an 8 GB card, so it remains disabled until VRAM and node/model validation pass.

The application does not silently download or activate any of these. The selected checkpoint must be present in ComfyUI’s own inventory and the user must approve its license for the intended channel.

## Delivered engine path

The Aethera path is now:

1. creative direction returns structured notes;
2. `VisualRecipe` selects a professional preset and carries seed, dimensions, steps, CFG, sampler and scheduler;
3. `ComfyUiImageAdapter` validates the selected checkpoint and native nodes against `/object_info`;
4. it queues a native txt2img or img2img graph through `/prompt`, waits on `/history`, and downloads `/view` output;
5. the generated buffer receives a structural audit for dimensions and luminance variation;
6. only a real output is composed; fallback reports remain visible in the panel and production console.

Reference images use `/upload/image` and a native `LoadImage → VAEEncode → KSampler` graph. Jobs are serialized by a process-local GPU lease; memory can be released explicitly or after each generation.

## What is still blocked

The real six-case ComfyUI acceptance pass cannot be claimed until a server is running with at least one compatible checkpoint. ControlNet, IP-Adapter, LoRA, upscale and face-detail models also cannot be validated while their model inventory is empty. The current reference path is native img2img; it does not pretend to provide IP-Adapter identity locking.

To unblock the real pass, install/import a licensed checkpoint into the audited ComfyUI `models\checkpoints` directory, start ComfyUI on `127.0.0.1:8188`, and rerun the audit. The panel will then expose the reported checkpoint list rather than accepting an arbitrary model name.

## Validation already run

- ComfyUI client/workflow/discovery/adapter tests: passing;
- reference upload and img2img graph tests: passing;
- professional preset tests: passing;
- generated-image structural audit and GPU lease tests: passing;
- Aethera renderer build: passing, with existing `import.meta` and browser externalization warnings;
- desktop node typecheck: still reports the pre-existing JSX6142 in `test/delete-prompt-dialog.test.ts` because that tsconfig does not enable JSX.
