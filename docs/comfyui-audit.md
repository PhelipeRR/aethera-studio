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

The Aethera discovery path now probes both 8000 and 8188, then retargets the native adapter to the discovered ready endpoint. The existing `Start-ComfyUI.ps1` starts the server hidden and writes status/log files. Aethera now exposes an opt-in “iniciar ComfyUI se offline” setting: it invokes that fixed local script once, waits for readiness, reports missing/failed startup, and never retries indefinitely. The default remains off. The real recovery acceptance stopped the two verified ComfyUI processes and then reached `ready` through the Aethera service; evidence is `artifacts/comfyui-autostart-acceptance/report.json`.

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

### Model selection matrix

| Use case | Selected model | Decision and evidence |
| --- | --- | --- |
| Anime characters, key art, groups | Animagine XL 3.1 | Primary choice: anime-focused SDXL fine-tune, real generation passed on the 8 GB GPU, and the official card documents CreativeML OpenRAIL++-M terms including commercial use with restrictions. [official card](https://huggingface.co/cagliostrolab/animagine-xl-3.1) |
| Anime alternative / comparison | Illustrious XL v2.0 | Installed and generated successfully; the official card describes it as an SDXL anime model, but its CreativeML OpenRAIL-M terms deserve separate legal review before commercial distribution. [official card](https://huggingface.co/OnomaAIResearch/Illustrious-XL-v2.0) |
| Photorealistic gaming/cinematic | Juggernaut XL v9 | Evaluated but not downloaded: it is a photorealistic SDXL workhorse rather than an anime-first model, and the official card calls out separate restrictions for paid API deployment. It would add another ~7 GB checkpoint without a current production requirement. [official card](https://huggingface.co/RunDiffusion/Juggernaut-XL-v9) |
| Newer general-purpose candidate | FLUX.1 schnell | Evaluated but not downloaded: the official card identifies a 12B rectified-flow model and its ComfyUI/Diffusers path, with CPU offload suggested to save VRAM. That architecture and memory risk are not justified for this 8 GB SDXL pipeline until a dedicated benchmark is requested. [official card](https://huggingface.co/black-forest-labs/FLUX.1-schnell) |

No additional checkpoint was downloaded merely to enlarge the inventory. The current selection is Animagine for anime/NextWorth experiments and Illustrious as the controlled alternative; gaming realism remains a documented future benchmark rather than an unverified claim.

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

The six baseline requests completed the structural gate: PNG, expected dimensions, three channels, and non-flat luminance. The latest rerun on 2026-11-17 produced the following measurements:

| Case | Resolution | Seed | Time | Peak VRAM |
| --- | ---: | ---: | ---: | ---: |
| anime individual | 768×768 | 10000 | 6,501 ms | 7,627 MiB |
| anime 2 | 1024×576 | 10001 | 12,069 ms | 7,627 MiB |
| cyberpunk trio | 1024×576 | 10002 | 2,979 ms | 7,401 MiB |
| cyberpunk group 8 | 1024×576 | 10003 | 2,954 ms | 7,369 MiB |
| gaming thumbnail | 1280×720 | 10004 | 4,456 ms | 7,433 MiB |
| NextWorth banner | 1280×720 | 10005 | 4,556 ms | 7,369 MiB |

The report now records `acceptanceStatus: structural_pass_pending_human_review` and a separate `humanReview.status: pending`. The visual recheck found the close-up usable; the two-character combat image was mostly silhouettes, the trio and eight-character cases were dominated by background/silhouettes, and the gamer thumbnail and NextWorth banner lacked a reliably readable focal subject. The baseline therefore proves the runtime path and VRAM envelope, not production visual quality.

### Full Aethera path acceptance

Report: `artifacts/comfyui-aethera-six-case-acceptance/report.json`; composed PNGs: `artifacts/comfyui-aethera-six-case-acceptance/*.png`.

This pass exercised the real desktop service chain — creative direction, visual recipe, native ComfyUI generation, regional inpaint for multi-character cases, editable composition, persistence, and report generation — instead of calling the image adapter directly:

| Case | Seed | Total time | Peak VRAM | Generated → document |
| --- | ---: | ---: | ---: | ---: |
| anime individual | 31000 | 50,444 ms | 7,630 MiB | 1024×576 → 1280×720 |
| anime 2 | 31001 | 92,000 ms | 7,400 MiB | 1024×576 → 1280×720 |
| cyberpunk trio | 31002 | 83,781 ms | 7,423 MiB | 1024×576 → 1280×720 |
| cyberpunk group 8 | 31003 | 96,900 ms | 7,364 MiB | 1024×576 → 1280×720 |
| gamer thumbnail | 31004 | 72,623 ms | 7,358 MiB | 1024×576 → 1280×720 |
| NextWorth banner | 31005 | 86,555 ms | 7,395 MiB | 1024×576 → 2560×1440 |

All six returned `generated` with the structural audit passed and `acceptanceStatus: structural_and_integration_pass_pending_human_review`. The visual inspection in this run found a strong anime close-up, a readable gamer focal subject, and a coherent panoramic banner; the two-character, trio, and banner outputs still showed character-count drift (extra visible figures), while the eight-character group was readable but still needs a human count/anatomy check. These are visual observations, not final human approval.

> **Invalidated (2026-11-17 regional composition fix).** The ComfyUI log for this run shows `Failed to validate prompt … VAEEncodeForInpaint: mask, received_type(IMAGE) mismatch input_type(MASK)` for every multi-character case. `ProviderChainImageAdapter` swallowed the error and fell back to the local SDXL-Turbo worker (`local-sdxl-rembg`), while the report hard-coded `model: animagine-xl-3.1`. The four multi-character images and the banner of this run were therefore **not** Animagine/regional outputs. The run is preserved in `artifacts/comfyui-aethera-six-case-acceptance/previous-run-fallback-2026-11-17T0025/`.

### Regional composition fix (2026-11-17)

Root causes found with live evidence (ComfyUI log, isolated experiments in the session scratchpad, model card):

| Defect | Evidence | Fix |
| --- | --- | --- |
| Inpaint graph invalid on ComfyUI 0.20.1 | `LoadImage` output 0 (IMAGE) wired to `VAEEncodeForInpaint.mask` (MASK) → HTTP 400 | Mask goes through `ImageToMask` (red channel) + `GrowMask`; encoding uses `VAEEncode` + `SetLatentNoiseMask`, because `VAEEncodeForInpaint` greys the area and produced hard-edged grey boxes with the non-inpaint Animagine checkpoint |
| Local validator did not catch it | Validator only checked node presence | `validateComfyUiWorkflow` now checks every link type against the live `/object_info` signatures |
| Silent fallback misattributed | Chain returned `provider-chain`; report hard-coded the model | `ProviderChainImageAdapter.getLastServedProvider()`; the generation report carries `servedBy` + `engineParameters`; the acceptance script marks a fallback as `failed_wrong_provider` |
| Background pass drew the cast | Isolated run: prompt with the subject plus "no visible characters" still rendered 2 warriors | Background + per-region inpaint loop replaced by one txt2img pass with core `ConditioningSetArea`/`ConditioningCombine` regional prompts (strength 0.8) |
| Each region repainted with the group prompt, seed 0 | Region prompt contained "Two … warriors"; inpaint seed hard-coded to `0` | Recipe emits a distinct `solo, single character, full body, <trait>, <subject without count words>` prompt per region; repairs derive a per-bbox seed |
| Under-resolution | 1024×576 (0.59 MP) letterboxed and shrank subjects; the Animagine card lists 1344×768 for 16:9 | Recipe uses the nearest native SDXL bucket when `maxSide` is not forced |
| Presets not checkpoint-aware | Presets ran 10–14 steps with `dpmpp_2m` on every checkpoint | `checkpoint-profiles.ts`: Animagine XL 3.x uses the card envelope (Euler a, 24–30 steps, CFG 5–7, quality tags); Illustrious uses the same envelope marked `generic_sdxl` because its card publishes no parameters; unknown SDXL checkpoints keep preset numbers (Turbo/Lightning safety). Adjustments are recorded in the report |

Isolated comparison at 1344×768, seed 31001: plain txt2img kept characters tiny; area conditioning produced exactly two large characters for the duel and four (one extra) for the trio.

#### Six-case rerun after the fix

Report: `artifacts/comfyui-aethera-six-case-acceptance/report.json` (generated 2026-11-17T03:53:49Z); contact sheet: `contact-sheet.png`. Every case was served by `comfyui-native` with no fallback (`servedBy.fallbackErrors: []`), checkpoint `animagine-xl-3.1.safetensors`, Euler a, 24 steps, 1344×768.

| Case | Regions | Total time | Peak VRAM | Visual observation (not human approval) |
| --- | ---: | ---: | ---: | --- |
| anime individual | 0 | 61,016 ms | 7,211 MiB | clean anime face, aligned eyes; clear quality gain over the 1024×576 run; tight crop |
| anime 2 | 2 | 66,241 ms | 7,264 MiB | two main characters on left/right regions, plus one background silhouette |
| cyberpunk trio | 3 | 58,703 ms | 7,226 MiB | three main characters, but a crowd of small background figures |
| cyberpunk group 8 | 8 | 60,071 ms | 7,587 MiB | roughly eight foreground figures plus background crowd; needs human count/anatomy check |
| gamer thumbnail | 0 | 48,235 ms | 7,185 MiB | strong expressive focal face with headset |
| NextWorth banner | 2 | 60,042 ms | 7,217 MiB | two mecha heroes at the edges; the central safe band is busier than ideal |

Times include creative direction, composition, and persistence. Peak VRAM stayed under the 8 GB card with `releaseMemoryAfterGeneration` enabled.

A follow-up variant added `crowd, background people, bystanders, extra person` to the multi-character negative prompt. With the same seeds it improved the eight-character count but made the duel abstract and dropped the trio to two characters, so it was **rejected and reverted**; the evidence is in `run-crowd-negative-rejected/`. The remaining defect is background-figure drift in busy city scenes, not cloned faces. Next candidates, each to be judged on several seeds rather than one: a calmer `setting` for multi-character briefs, higher area strength for the cast regions, or an OpenPose skeleton per region via the installed ControlNet.

### Face refinement and upscale

- Animagine direct generation: `artifacts/comfyui-bootstrap/animagine-first-generation.png` — 768×768, generated, 10,700 ms, peak observed 7,714 MiB; coherent but tightly cropped.
- Illustrious direct generation: `artifacts/comfyui-bootstrap/illustrious-first-generation.png` — 768×768, generated, 6,286 ms; model loaded, but anatomy/prompt adherence needs tuning.
- Raw FaceDetailer workflow: `artifacts/comfyui-bootstrap/illustrious-facedetailer.png` — completed successfully.
- Aethera adapter FaceDetailer workflow: `artifacts/comfyui-bootstrap/aethera-facedetailer.png` — completed successfully in 16,337 ms.
- Aethera adapter upscale with 4x-UltraSharp: `artifacts/comfyui-bootstrap/aethera-facedetailer-upscaled.png` — 3072×3072, completed in 6,325 ms.

### ControlNet and IP-Adapter acceptance

Report: `artifacts/comfyui-advanced-acceptance/report.json`; images: `artifacts/comfyui-advanced-acceptance/*.png`.

The real advanced pass used the installed Animagine checkpoint and the Aethera FaceDetailer image as reference. Both preprocessors executed through ComfyUI and all four generation cases passed the structural audit:

| Case | Seed | Time | Peak VRAM | Visual review in this run |
| --- | ---: | ---: | ---: | --- |
| ControlNet Depth | 21001 | 18,478 ms | 7,396 MiB | coherent neon tech character; high contrast but visually usable |
| ControlNet OpenPose | 21004 | 20,184 ms | 7,468 MiB | coherent anime portrait with pose conditioning; crop is tight |
| IP-Adapter Plus, weight 0.80 | 21002 | 12,484 ms | 7,237 MiB | rejected: near-white overexposed output despite structural pass |
| IP-Adapter Plus, weight 0.35 | 21003 | 10,543 ms | 7,545 MiB | safer observed candidate: coherent face, anatomy, and reference styling |

The panel therefore defaults IP-Adapter weight to `0.35`. This is an evidence-based starting point, not a guarantee of identity fidelity for arbitrary references, and the visual review in this run is not a human production approval. The structural audit still does not replace human semantic review.

### CS9 — stabilization and visual acceptance (2026-11-17)

**Status: awaiting the user's visual approval.** Nothing below is a human approval; automated tests and structural audits are not a substitute.

#### Why extra figures appeared and characters were lost

Measured on the v1 prompts plus three scratchpad experiment rounds (1344×768, Animagine XL 3.1):

1. The global prompt carried the whole cast and applied to the entire canvas, so the model drew the cast again outside the regions.
2. Every region prompt contained all cast descriptions, so regions competed for the same people.
3. `ConditioningSetArea` is only a soft bias; it does not constrain how many bodies appear.
4. The 8-character grid gave each figure about 192 px of width.
5. A "no humans" background mask leaked through global attention and erased characters (rejected).

| Experiment | 2 chars | 3 chars | 8 chars |
| --- | --- | --- | --- |
| Area conditioning only (v1) | 2 + 1 background silhouette | 3 + crowd | ~8 + crowd |
| Crowd negative prompt (v2, rejected) | abstract duel | dropped to 2 | better count |
| One OpenPose skeleton per region (thibaud SDXL OpenPose, 0.75 / end 0.7; 0.9 / end 0.85 for 4+) | exactly 2 | exactly 3, distinct | ~8 separated, faces small |
| Depth silhouettes | unreliable | unreliable | unreliable |

Chosen architecture (commit 3587b38): cast removed from the global prompt; one `solo, single character, full body, <description>` prompt per region; one synthetic COCO-18 OpenPose skeleton per region when the OpenPose ControlNet is installed (otherwise `area_only`, recorded with a reason); a masked scene-background prompt outside the figure boxes; a staged two-row layout for 4+ characters; banner characters forced to the edges with a calm masked prompt over the title safe area. Single-character cases keep the plain single-pass graph.

#### Bugs found and fixed during CS9

- **FaceDetailer returned the unrefined image.** History outputs iterate in node order, so "first image" was the base at node 7, not the FaceDetailer output at node 22. The adapter now picks node 22 and exposes the base from the same execution (`getLastUnrefinedImage`).
- **False SDXL-Turbo fallback.** A single `/history` poll exceeded the 15 s request timeout while ComfyUI was loading the checkpoint and ControlNet; the job finished in 61 s, but the chain fell back to the local worker. Poll timeouts are now retried until the overall deadline.
- **Same seed is not the same prompt.** The creative director (LLM) rewrites style text on every run, so `preview` and `professional` runs differ even with the same seed. The valid basic-vs-refined comparison is the professional base against the refined image from the same graph execution.

#### Six cases — run `run-cs9-2026-11-17T1050`

All 12 generations were served by `comfyui-native` with no fallback, `animagine-xl-3.1.safetensors`, Euler a, 24 steps, 1344×768, peak VRAM 7,084–7,509 MiB. Report: `artifacts/comfyui-aethera-six-case-acceptance/run-cs9-2026-11-17T1050/report.json`; contact sheet: `contact-sheet-basic-vs-refined.png`.

| Case | Workflow | preview / professional | Observation (not approval) |
| --- | --- | ---: | --- |
| anime individual | single pass | 63 / 76 s | clean close-up |
| anime 2 | regional + OpenPose | 87 / 112 s | preview: 2 + two tiny background figures; professional: exactly 2 |
| cyberpunk trio | regional + OpenPose | 96 / 99 s | 3 main characters plus small pedestrians and one extra figure |
| cyberpunk 8 | regional + OpenPose (staged) | 104 / 120 s | about 8 figures but abstract and glitchy; **fails** distinguishability |
| gamer thumbnail | single pass | 69 / 72 s | strong expressive face |
| NextWorth banner | regional + OpenPose + calm zone | 106 / 143 s | characters at the edges, calm central area; upscaled 1344×768 → 2560×1440 with 4x-UltraSharp in 11 s |

**Refinement verdict.** FaceDetailer changed 0% of pixels on the 2/3/8-character scenes (faces below the detector's reach). It changed 8.5% on the anime close-up with a marginal visual gain and 4.9% on the gamer close-up, where the eyes got worse. FaceDetailer is therefore **opt-in** in the `professional` profile. Model upscale stays on, but only runs when the document is larger than the generation (banner yes, 1280×720 thumbnails no).

#### Crowd-suppression LoRA (user-authorized, 2026-11-17)

No LoRA "counts" characters. The closest targeted model found is the ntc-ai SDXL slider [`photobombing`](https://huggingface.co/ntc-ai/SDXL-LoRA-slider.photobombing): MIT, SDXL 1.0, 8,789,076 bytes, SHA-256 `505c1062a1611758b8e3b58fab724dd687acc8a2064979b9008f2dcfd09e0b31` (verified after download). It is installed as `models/loras/ntc-sdxl-slider-photobombing.safetensors` and used with a negative weight. It adds no relevant VRAM on the 8 GB card.

| Seed | Case | Without LoRA | LoRA −1.5 (model and CLIP) |
| --- | --- | --- | --- |
| 31001 | duo | 2 + two tiny extras | exactly 2 |
| 31002 | trio | 3 + extras | exactly 3, clean background |
| 31003 | 8 | chaotic | still chaotic |
| 31101 | duo | exactly 2 | **0 characters (cast erased)** |
| 31102 | trio | 3 + 1 extra + pedestrians | 3 + 1 extra, pedestrians gone |

| Seed | Case | LoRA UNet −1.0, CLIP 0 |
| --- | --- | --- |
| 31101 | duo | **0 characters (figures turned into monoliths)** |
| 31102 | trio | 3 + 1 extra, fewer pedestrians |

**Verdict: rejected as a default.** The slider suppresses people in general, not only extras: on one of two duo seeds it erased the whole cast at both strengths. It stays installed and available as an opt-in control (`crowdSuppression: true` in the service, `CS9_CROWD=on` or `CS9_LORA=…` in the acceptance script), reported in `generation.crowdSuppression`. Runs: `run-cs9-lora-2026-11-17T1109`, `run-cs9-2026-11-17T1117`, `run-cs9-lora-2026-11-17T1121`, `run-cs9-lora-2026-11-17T1125` (with the `lora-vs-nolora*.png` and `none-vs-1.5-vs-mild.png` comparisons).

#### Still open

- **8 characters** remain abstract and glitchy at 1344×768 (about 168 px per figure). This needs either a larger canvas with tiled or second-pass detail, or fewer characters per frame.
- **Extra background figures** still appear in some trio seeds. The next robust step is an automatic person-count gate: run a person detector on the result, then reject and regenerate with a new seed when the count differs. This needs no LoRA, just a detector model.
- Character descriptions are only partially followed; for example, the brawler's chrome arms and the sniper's pink hair did not come through reliably.
- The OpenPose SDXL model (thibaud) has an "other" license that still needs commercial review.

## Remaining work / blockers

1. Add semantic/human-review recording to the six-case acceptance so subject count, anatomy, focal point, text-safe area, and “empty composition” become explicit acceptance criteria.
2. Improve multi-character and banner quality with regional composition/conditioning; do not mark the structural baseline as visually accepted.
3. Evaluate production-safe OpenPose licensing before shipping that model in a commercial distribution, and install/validate a LoRA only if a concrete style requirement needs it.
4. Decide whether the duplicate dependency installation in the unused Comfy Desktop venv should be cleaned up. The live server uses the Documents venv and is not affected.

### LoRA catalog and requested selection (2026-11-17)

The native integration now discovers LoRAs from `models/loras`, reads the bounded safetensors header when available, and records architecture, trigger words, category, compatibility, priority, and purpose. Filename-only entries remain `unknown`/unverified and are excluded from automatic selection. Manual stacks are limited to three deduplicated relative model names; native workflows chain `LoraLoader` and `LoraLoaderModelOnly` before ControlNet/IP-Adapter nodes.

| Selection | Priority | Purpose | Current state |
| --- | --- | --- | --- |
| Animagine XL 3.1 checkpoint | Essential | Anime characters and illustrations | Installed and selected for anime/NextWorth |
| Illustrious XL checkpoint | High | Alternative anime styles and characters | Installed and available as alternative |
| Character LoRA | High | Fidelity for named characters such as Goku, Frieren, or Guts | Catalog category supported; no file installed |
| Cinematic style LoRA | Medium | Dramatic lighting and atmosphere | Catalog category supported; no file installed |
| Manga style LoRA | Medium | Black-and-white linework and hatching | Catalog category supported; no file installed |
| Visual-effects LoRA | Optional | Energy, aura, and stylized effects | Catalog category supported; no file installed |
| Games LoRA | As needed | Game-specific styles | Catalog category supported; no file installed |

The desktop flow now exposes `off`, `manual`, and `automatic` modes, shows compatibility evidence and warnings, persists the effective stack per project, and includes the selection explanation in the generation report. No LoRA was downloaded in this pass: installation remains gated on a concrete candidate, license review, and explicit confirmation because the current runtime has no verified LoRA file to benchmark.

The install policy is also explicit in `lora-install-policy.ts`: only HTTPS Hugging Face/Civitai hosts or local files are accepted, the checkpoint architecture must match, the license and file size must be known, and a SHA-256 is mandatory. The desktop service/preload expose the same verified installer, which streams to a temporary file and atomically renames only after verification. External downloads always require confirmation; no network installer was invoked in this run.

Candidate review for the requested first style benchmark:

- [`SUPER321/my-animestyle-lora`](https://huggingface.co/SUPER321/my-animestyle-lora) is an SDXL anime-style LoRA with trigger `animestyle`, a 99.7 MB repository file, and CreativeML OpenRAIL-M metadata. It is a plausible style candidate, but it is community-published and still requires commercial-license review plus explicit installation confirmation; it was not downloaded.
- [`ByteDance/SDXL-Lightning`](https://huggingface.co/ByteDance/SDXL-Lightning) is an official OpenRAIL++ speed/distillation project with LoRA files, but its card says the LoRA path is for non-SDXL bases and recommends the full checkpoint otherwise. It was therefore not selected for the current Animagine/Illustrious SDXL production path.

The current three-candidate comparison, including exact file URLs, byte sizes, LFS hashes, trigger words, and license gaps, is recorded in [`docs/comfyui-lora-candidates.md`](comfyui-lora-candidates.md). The HanaMori character candidate and the cinematic-lighting candidate have canonical license metadata and remain eligible only after explicit installation confirmation. The manga candidate exposes only the bare `openrail++` identifier without a license document; the installer now rejects that ambiguous identifier until its legal terms are verified.
