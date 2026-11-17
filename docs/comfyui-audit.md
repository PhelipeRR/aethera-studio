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

The Aethera discovery path now probes both 8000 and 8188, then retargets the native adapter to the discovered ready endpoint. The existing `Start-ComfyUI.ps1` starts the server hidden and writes status/log files. Aethera now exposes an opt-in “iniciar ComfyUI se offline” setting: it invokes that fixed local script once, waits for readiness, reports missing/failed startup, and never retries indefinitely. The default remains off.

## Models and licenses

| Asset | Local file | Size | SHA-256 | Source/license |
| --- | --- | ---: | --- | --- |
| Animagine XL 3.1 | `models/checkpoints/animagine-xl-3.1.safetensors` | 6,938,325,776 | `e3c47aedb06418c6c331443cd89f2b3b3b34b7ed2102a3d4c4408a8d35aad6b0` | [official model card](https://huggingface.co/cagliostrolab/animagine-xl-3.1), OpenRAIL++ |
| Illustrious XL v2.0 | `models/checkpoints/Illustrious-XL-v2.0.safetensors` | 6,938,040,674 | `c2a1a3eaa13d4c107dc7e00c3fe830cab427aa026362740ea094745b3422a331` | [official model card](https://huggingface.co/OnomaAIResearch/Illustrious-XL-v2.0), CreativeML OpenRAIL-M |
| 4x-UltraSharp | `models/upscale_models/4x-UltraSharp.pth` | 66,961,958 | `a5812231fc936b42af08a5edba784195495d303d5b3248c24489ef0c4021fe01` | [official file page](https://huggingface.co/NiceTwice/4x-UltraSharp/blob/main/4x-UltraSharp.pth) |
| ControlNet Depth SDXL | `models/controlnet/xinsir-controlnet-depth-sdxl-1.0.safetensors` | 2,502,139,104 | `ea3770af4c33ea8ba8dccc0106ec5d5c5c6e504eb382119a3ccac3c9d973d344` | [official file page](https://huggingface.co/xinsir/controlnet-depth-sdxl-1.0/blob/main/diffusion_pytorch_model.safetensors), Apache-2.0 |
| ControlNet OpenPose SDXL | `models/controlnet/thibaud-controlnet-openpose-sdxl-1.0.safetensors` | 5,004,167,829 | `5a4b928cb1e93748217900cb66d4135bf70d932d2924232f925910fad9e43a92` | [official file page](https://huggingface.co/thibaud/controlnet-openpose-sdxl-1.0/blob/main/OpenPoseXL2.safetensors), license marked “other” and requires review |
| IP-Adapter Plus SDXL ViT-H | `models/ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors` | 847,517,512 | `3f5062b8400c94b7159665b21ba5c62acdcd7682262743d7f2aefedef00e6581` | [official file page](https://huggingface.co/h94/IP-Adapter/blob/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors), Apache-2.0 |
| IP-Adapter CLIP Vision ViT-H | `models/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors` | 2,528,373,448 | `6ca9667da1ca9e0b0f75e46bb030f7e011f44f86cbfb8d5a36590fcd7507b030` | [official file page](https://huggingface.co/h94/IP-Adapter/blob/main/models/image_encoder/model.safetensors), Apache-2.0 |

Both checkpoints are recognized by `/object_info`; no duplicate checkpoint name was found in the discovered model roots.

## Custom nodes and capabilities

- [ComfyUI Manager](https://github.com/Comfy-Org/ComfyUI-Manager), commit `c8bf0d48f33382ba621a5b44820cc636d32e38ce`.
- [Impact Pack](https://github.com/ltdrdata/ComfyUI-Impact-Pack), commit `4a8a239abae00e5e72a54481427d43e9362a42bb`.
- [Impact Subpack](https://github.com/ltdrdata/ComfyUI-Impact-Subpack), commit `50c7b71a6a224734cc9b21963c6d1926816a97f1`.
- [ComfyUI IPAdapter Plus](https://github.com/cubiq/ComfyUI_IPAdapter_plus), commit `a0f451a5113cf9becb0847b92884cb10cbdec0ef`; license declared GPL-3.0.
- [comfyui_controlnet_aux](https://github.com/Fannovel16/comfyui_controlnet_aux), commit `b9abafa1019e230ebd674e4ae93f11bdf9d8dfc2`; Apache-2.0.
- Live `/object_info` exposes `FaceDetailer`, `DetailerForEach`, `UltralyticsDetectorProvider`, and `UpscaleModelLoader`.
- Detector installed: `models/ultralytics/bbox/face_yolov8m.pt` (52,026,019 bytes).
- SAM model installed: `models/sams/sam_vit_b_01ec64.pth` (375,042,383 bytes).
- Current live capability inventory: native txt2img, img2img, inpaint, ControlNet, IP-Adapter, FaceDetailer, and upscale are available; LoRA remains unavailable because no LoRA model is installed.

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

### ControlNet and IP-Adapter acceptance

Report: `artifacts/comfyui-advanced-acceptance/report.json`; images: `artifacts/comfyui-advanced-acceptance/*.png`.

The real advanced pass used the installed Animagine checkpoint and the Aethera FaceDetailer image as reference. Both preprocessors executed through ComfyUI and all four generation cases passed the structural audit:

| Case | Seed | Time | Peak VRAM | Human review |
| --- | ---: | ---: | ---: | --- |
| ControlNet Depth | 21001 | 18,478 ms | 7,396 MiB | coherent neon tech character; high contrast but visually usable |
| ControlNet OpenPose | 21004 | 20,184 ms | 7,468 MiB | coherent anime portrait with pose conditioning; crop is tight |
| IP-Adapter Plus, weight 0.80 | 21002 | 12,484 ms | 7,237 MiB | rejected: near-white overexposed output despite structural pass |
| IP-Adapter Plus, weight 0.35 | 21003 | 10,543 ms | 7,545 MiB | accepted as the safer observed default: coherent face, anatomy, and reference styling |

The panel therefore defaults IP-Adapter weight to `0.35`. This is an evidence-based starting point, not a guarantee of identity fidelity for arbitrary references. The structural audit still does not replace human semantic review.

## Remaining work / blockers

1. Add semantic/human-review recording to the six-case acceptance so subject count, anatomy, focal point, text-safe area, and “empty composition” become explicit acceptance criteria.
2. Improve multi-character and banner quality with regional composition/conditioning; do not mark the structural baseline as visually accepted.
3. Add a full Aethera UI E2E for the opt-in auto-start and verify recovery after stopping the live server; the service path and settings validation are implemented, but this desktop-level recovery scenario is still pending.
4. Evaluate production-safe OpenPose licensing before shipping that model in a commercial distribution, and install/validate a LoRA only if a concrete style requirement needs it.
5. Decide whether the duplicate dependency installation in the unused Comfy Desktop venv should be cleaned up. The live server uses the Documents venv and is not affected.
