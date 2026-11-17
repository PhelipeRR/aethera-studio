# Aethera SDXL LoRA candidates

Research date: 2026-11-17

Scope: primary Hugging Face model cards and Hugging Face repository metadata only. No model weights were downloaded. URLs below are direct `resolve/main` download URLs for the `.safetensors` files.

## Summary

| Category | Candidate | Base / architecture | License | Declared file size | SHA-256 exposed by primary source |
|---|---|---|---|---:|---|
| Anime character | [HanaMori AI Art LoRA - Anime Style v1](https://huggingface.co/hanamori-ai/hanamori-lora) | SDXL 1.0; compatible with SDXL 1.0 or compatible checkpoints | CreativeML Open RAIL-M | 85,426,548 bytes (81.42 MiB) | `46e070b9d13f4acbb1bf7c876ec83610534221d24d60f94aef134ff8a431b9bb` |
| Manga style | [MANGA_style_LoRA](https://huggingface.co/s3ren1ty/MANGA_style_LoRA) | SDXL 1.0 (`stabilityai/stable-diffusion-xl-base-1.0`); text-encoder LoRA disabled | `openrail++` identifier in the model card; no separate license text/link is provided there | 23,390,424 bytes (22.30 MiB) | `7c47ce28b81b03407d26ac6cfacb752ac673dbca7bc49b11b9648c298eaed10a` |
| Cinematic lighting | [ntcai.xyz slider - cinematic lighting with moody ambiance](https://huggingface.co/ntc-ai/SDXL-LoRA-slider.cinematic-lighting-with-moody-ambiance) | SDXL 1.0 (`stabilityai/stable-diffusion-xl-base-1.0`) | MIT | 8,789,076 bytes (8.38 MiB) | `fb0e5744ef1b2e08d016f60d464940e06335a52fe20b1184476da09348368bdf` |

## 1. Anime character — HanaMori

- **Model card:** [HanaMori AI Art LoRA - Anime Style v1](https://huggingface.co/hanamori-ai/hanamori-lora)
- **Direct download:** [`HanaMori_lora.safetensors`](https://huggingface.co/hanamori-ai/hanamori-lora/resolve/main/HanaMori_lora.safetensors)
- **Architecture/base compatibility:** SDXL LoRA trained for `stabilityai/stable-diffusion-xl-base-1.0`; the card says “SDXL 1.0 or compatible.” It explicitly lists ComfyUI, Automatic1111, and Diffusers as compatible tools.
- **Trigger words:** `hanamori_style, anime character, soft lighting`
- **License:** CreativeML Open RAIL-M. The card states that generated images may be used commercially. Follow the linked license terms for redistribution and other uses.
- **Declared file size:** 85,426,548 bytes (81.42 MiB), from the repository tree metadata for the selected file.
- **SHA-256:** `46e070b9d13f4acbb1bf7c876ec83610534221d24d60f94aef134ff8a431b9bb`, exposed as the file's Hugging Face LFS `oid` in the [repository tree API](https://huggingface.co/api/models/hanamori-ai/hanamori-lora/tree/main?recursive=true). The API does not label it “SHA-256” in prose; LFS object IDs are SHA-256 hashes.
- **Primary-source metadata:** [raw model card](https://huggingface.co/hanamori-ai/hanamori-lora/raw/main/README.md) · [repository tree metadata](https://huggingface.co/api/models/hanamori-ai/hanamori-lora/tree/main?recursive=true)

## 2. Manga style — SUI ISHIDA-inspired trigger

- **Model card:** [s3ren1ty/MANGA_style_LoRA](https://huggingface.co/s3ren1ty/MANGA_style_LoRA)
- **Direct download:** [`pytorch_lora_weights.safetensors`](https://huggingface.co/s3ren1ty/MANGA_style_LoRA/resolve/main/pytorch_lora_weights.safetensors)
- **Architecture/base compatibility:** LoRA adaptation weights for `stabilityai/stable-diffusion-xl-base-1.0`; the card says the LoRA was trained with text-encoder LoRA disabled and uses `madebyollin/sdxl-vae-fp16-fix` as the training VAE.
- **Trigger words:** `portrait in SUI ISHIDA manga style`
- **License:** The model-card metadata declares `openrail++`. **Unavailable:** the card does not provide a separate license text or canonical license URL, so the exact legal terms should be verified before redistribution or commercial use.
- **Declared file size:** 23,390,424 bytes (22.30 MiB), from the repository tree metadata for the selected root file.
- **SHA-256:** `7c47ce28b81b03407d26ac6cfacb752ac673dbca7bc49b11b9648c298eaed10a`, exposed as the file's Hugging Face LFS `oid` in the [repository tree API](https://huggingface.co/api/models/s3ren1ty/MANGA_style_LoRA/tree/main?recursive=true). The API does not label it “SHA-256” in prose; LFS object IDs are SHA-256 hashes.
- **Primary-source metadata:** [raw model card](https://huggingface.co/s3ren1ty/MANGA_style_LoRA/raw/main/README.md) · [repository tree metadata](https://huggingface.co/api/models/s3ren1ty/MANGA_style_LoRA/tree/main?recursive=true)

## 3. Cinematic style — moody lighting slider

- **Model card:** [ntcai.xyz slider - cinematic lighting with moody ambiance](https://huggingface.co/ntc-ai/SDXL-LoRA-slider.cinematic-lighting-with-moody-ambiance)
- **Direct download:** [`cinematic lighting with moody ambiance.safetensors`](https://huggingface.co/ntc-ai/SDXL-LoRA-slider.cinematic-lighting-with-moody-ambiance/resolve/main/cinematic%20lighting%20with%20moody%20ambiance.safetensors)
- **Architecture/base compatibility:** SDXL LoRA for `stabilityai/stable-diffusion-xl-base-1.0`.
- **Trigger words:** `cinematic lighting with moody ambiance`
- **License:** MIT, declared in the model-card metadata.
- **Declared file size:** 8,789,076 bytes (8.38 MiB), from the repository tree metadata for the selected file.
- **SHA-256:** `fb0e5744ef1b2e08d016f60d464940e06335a52fe20b1184476da09348368bdf`, exposed as the file's Hugging Face LFS `oid` in the [repository tree API](https://huggingface.co/api/models/ntc-ai/SDXL-LoRA-slider.cinematic-lighting-with-moody-ambiance/tree/main?recursive=true). The API does not label it “SHA-256” in prose; LFS object IDs are SHA-256 hashes.
- **Primary-source metadata:** [raw model card](https://huggingface.co/ntc-ai/SDXL-LoRA-slider.cinematic-lighting-with-moody-ambiance/raw/main/README.md) · [repository tree metadata](https://huggingface.co/api/models/ntc-ai/SDXL-LoRA-slider.cinematic-lighting-with-moody-ambiance/tree/main?recursive=true)

## Notes and limitations

- The file sizes are the exact byte counts declared by Hugging Face repository metadata, with MiB conversions added here.
- The hashes are the primary source's LFS `oid` values for the exact selected files. No local checksum was computed because the weights were not downloaded.
- For the manga candidate, the `openrail++` identifier is available but the model card does not expose a license document or canonical license URL; this is an explicit metadata gap, not an inferred license grant.
