# ComfyUI local audit

Status checked on 2026-11-16/17. This document records the operational evidence for the local image-generation path; large PNG outputs remain outside Git under `artifacts/`.

## Runtime

| Item | Evidence |
| --- | --- |
| Endpoint | `http://127.0.0.1:8000` ready; port 8188 is not listening |
| ComfyUI | `0.20.1` |
| Python | `C:\Users\Pheli\Documents\ComfyUI\.venv\Scripts\python.exe`, Python 3.12 |
| PyTorch/CUDA | `2.10.0+cu130`, CUDA 13.0 |
| GPU | NVIDIA GeForce RTX 4060 Ti, 8,585,216,000 bytes VRAM |
| Binding | localhost-only (`--listen 127.0.0.1 --port 8000`) |
| Runtime paths | base directory `C:\Users\Pheli\Documents\ComfyUI`; extra paths from `extra_models_config.yaml` |

The Aethera discovery path now probes both 8000 and 8188, then retargets the native adapter to the discovered ready endpoint. The existing `Start-ComfyUI.ps1` starts the server hidden and writes status/log files. Aethera automatic launch on desktop startup was not independently verified.

## Models and licenses

| Asset | Local file | Size | SHA-256 | Source/license |
| --- | --- | ---: | --- | --- |
| Animagine XL 3.1 | `models/checkpoints/animagine-xl-3.1.safetensors` | 6,938,325,776 | `e3c47aedb06418c6c331443cd89f2b3b3b34b7ed2102a3d4c4408a8d35aad6b0` | [official model card](https://huggingface.co/cagliostrolab/animagine-xl-3.1), OpenRAIL++ |
| Illustrious XL v2.0 | `models/checkpoints/Illustrious-XL-v2.0.safetensors` | 6,938,040,674 | `c2a1a3eaa13d4c107dc7e00c3fe830cab427aa026362740ea094745b3422a331` | [official model card](https://huggingface.co/OnomaAIResearch/Illustrious-XL-v2.0), CreativeML OpenRAIL-M |
| 4x-UltraSharp | `models/upscale_models/4x-UltraSharp.pth` | 66,961,958 | `a5812231fc936b42af08a5edba784195495d303d5b3248c24489ef0c4021fe01` | [official file page](https://huggingface.co/NiceTwice/4x-UltraSharp/blob/main/4x-UltraSharp.pth) |

Both checkpoints are recognized by `/object_info`; no duplicate checkpoint name was found in the discovered model roots.

## Custom nodes and capabilities

- [ComfyUI Manager](https://github.com/Comfy-Org/ComfyUI-Manager), commit `c8bf0d48f33382ba621a5b44820cc636d32e38ce`.
- [Impact Pack](https://github.com/ltdrdata/ComfyUI-Impact-Pack), commit `4a8a239abae00e5e72a54481427d43e9362a42bb`.
- [Impact Subpack](https://github.com/ltdrdata/ComfyUI-Impact-Subpack), commit `50c7b71a6a224734cc9b21963c6d1926816a97f1`.
- Live `/object_info` exposes `FaceDetailer`, `DetailerForEach`, `UltralyticsDetectorProvider`, and `UpscaleModelLoader`.
- Detector installed: `models/ultralytics/bbox/face_yolov8m.pt` (52,026,019 bytes).
- SAM model installed: `models/sams/sam_vit_b_01ec64.pth` (375,042,383 bytes).
- Current live capability inventory: native txt2img, img2img, inpaint, FaceDetailer, and upscale are available; ControlNet, IP-Adapter, and LoRA are not yet available because their nodes/models are not installed.

## Real generation evidence

### Baseline acceptance

Report: `artifacts/comfyui-acceptance/report.json`; images: `artifacts/comfyui-acceptance/*.png`.

The six baseline requests completed the structural gate: PNG, expected dimensions, three channels, and non-flat luminance. The measured durations were:

| Case | Resolution | Seed | Time | Peak VRAM |
| --- | ---: | ---: | ---: | ---: |
| anime individual | 768×768 | 10000 | 15,638 ms | 7,419 MiB |
| anime 2 | 1024×576 | 10001 | 3,135 ms | 7,420 MiB |
| anime 4/trio | 1024×576 | 10002 | 11,001 ms | 7,637 MiB |
| anime 8 | 1024×576 | 10003 | 11,243 ms | 7,611 MiB |
| gaming thumbnail | 1280×720 | 10004 | 4,538 ms | 7,394 MiB |
| NextWorth banner | 1280×720 | 10005 | 4,562 ms | 7,422 MiB |

The structural gate is not a semantic or aesthetic gate. Human review found the close-up usable, but the two/multi-character, gamer, and NextWorth banner outputs were mostly silhouettes/backgrounds and did not reliably satisfy the requested subjects. The baseline therefore proves the runtime path, not production visual quality. The current report includes the post-install capability snapshot and sampled peak VRAM.

### Face refinement and upscale

- Animagine direct generation: `artifacts/comfyui-bootstrap/animagine-first-generation.png` — 768×768, generated, 10,700 ms, peak observed 7,714 MiB; coherent but tightly cropped.
- Illustrious direct generation: `artifacts/comfyui-bootstrap/illustrious-first-generation.png` — 768×768, generated, 6,286 ms; model loaded, but anatomy/prompt adherence needs tuning.
- Raw FaceDetailer workflow: `artifacts/comfyui-bootstrap/illustrious-facedetailer.png` — completed successfully.
- Aethera adapter FaceDetailer workflow: `artifacts/comfyui-bootstrap/aethera-facedetailer.png` — completed successfully in 16,337 ms.
- Aethera adapter upscale with 4x-UltraSharp: `artifacts/comfyui-bootstrap/aethera-facedetailer-upscaled.png` — 3072×3072, completed in 6,325 ms.

## Remaining work / blockers

1. Add semantic/human-review recording to the six-case acceptance so subject count, anatomy, focal point, text-safe area, and “empty composition” become explicit acceptance criteria.
2. Improve multi-character and banner quality with regional composition/conditioning; do not mark the structural baseline as visually accepted.
3. Install and hash-verify compatible ControlNet and IP-Adapter nodes/models before exposing those controls. The UI remains feature-gated and currently hides unavailable models.
4. Verify Aethera-to-ComfyUI startup/recovery end-to-end and decide whether the duplicate dependency installation in the unused Comfy Desktop venv should be cleaned up. The live server uses the Documents venv and is not affected.
