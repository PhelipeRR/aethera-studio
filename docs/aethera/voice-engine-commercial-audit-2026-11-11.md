# Voice-engine commercial audit — OmniVoice / VoiceStudio

**Date:** 2026-11-11
**Scope:** research-only audit for NeuralBridge Studio / Aethera. This report does not modify product code, the Rights Manager, manifests, or model files. No commit or push was made.

## Executive conclusion

OmniVoice through VoiceStudio is **not commercially cleared on the evidence reviewed**. The result is not caused by one undifferentiated “model license”:

- **VoiceStudio application:** AGPL-3.0-only. Its upstream notice expressly permits commercial and internal business use of the application under AGPL terms, but a proprietary/closed-source embedded product requires analyzing AGPL obligations or obtaining the maintainer's commercial license.
- **OmniVoice code:** Apache-2.0.
- **OmniVoice pretrained weights:** the official model card says **CC-BY-NC**, with no Creative Commons version specified. This is a non-commercial restriction on the pretrained model layer, not a complete statement of generated-audio copyright or ownership.
- **Bundled audio tokenizer:** a separate Boson Higgs Audio 2 Community License, based on and incorporating Meta Llama 3 Community License terms. It requires notices/attribution when covered materials or products/services are distributed, prohibits using the materials or their outputs to improve another LLM, and requires an expanded Boson license above 100,000 annual active users.
- **Generated audio:** no inspected upstream source grants a general commercial-output license, assigns output ownership, or confirms that an output is free of third-party voice/data claims. The tokenizer instead places output/results “as is” and makes the user responsible for determining suitability and redistribution. Therefore the output status is **unknown**, not automatically “NC” and not automatically “commercially free.”
- **Voice/preset:** the local Aethera design uses a seed/instruction rather than a real-person reference, which is a useful product constraint, but it does not replace the separate model, voice, and output review required by VoiceStudio's own notice.

Operational decision: keep OmniVoice/VoiceStudio narration in the existing **non-commercial/demo-only** scope. Do not mark it commercially cleared without a different model/voice evidence set or written rights from the relevant licensors.

## Legal layers: explicit versus unknown

| Layer | Explicit primary-source position | Still unknown / consequence |
|---|---|---|
| VoiceStudio inference software | VoiceStudio is AGPL-3.0-only. Commercial/internal use of the application itself is allowed under AGPL. Network-provided modified versions have corresponding-source obligations. A paid commercial license is offered for proprietary embedding without AGPL copyleft obligations. | AGPL does not license third-party weights, tokenizers, voices, or outputs. Whether a particular integration is an independent process, an aggregate, or a combined proprietary work needs legal review. |
| OmniVoice code | The OmniVoice model card says the code is Apache-2.0; the VoiceStudio notice separately says its bundled `omnivoice/` Python package remains Apache-2.0 and is not relicensed by VoiceStudio. | The exact dependency inventory and notices for a redistributable build must still be preserved. Apache code permission does not make the pretrained weights commercial. |
| OmniVoice pretrained weights | The official `k2-fsa/OmniVoice` model card says the pretrained model is CC-BY-NC because of training-data constraints such as Emilia. It also prohibits unauthorized voice cloning/impersonation and illegal or unethical use. | The card does not state a CC version, does not identify an output grant, and does not clarify whether a particular commercial inference/output scenario is licensed. Treat commercial inference as restricted. |
| Bundled audio tokenizer | `audio_tokenizer/LICENSE` identifies Boson Higgs Audio 2 Community License, released 2025-06-20, based on the Meta Llama 3 Community License. It grants a limited, non-exclusive, worldwide, non-transferable, royalty-free license for use/reproduction/distribution/modification of Higgs Materials, subject to its conditions. | The license incorporates Meta's terms and acceptable-use policy. The exact installed tokenizer revision and all dependent Meta/Boson notices must be pinned before redistribution. This is not a blanket commercial-output clearance. |
| Tokenizer redistribution and product/service use | If covered Higgs Materials, derivative works, or a product/service using them is distributed or made available, the license requires a copy of the Boson and Meta terms plus specified prominent attribution. If the licensee/affiliate product or service exceeds 100,000 annual active users, an expanded Boson license is required before exercising the rights. | The threshold is only one condition; it does not waive other Meta/Boson terms, third-party rights, or the OmniVoice CC-BY-NC restriction. |
| Generated audio | The tokenizer license expressly refers to “output or results,” prohibits using them to improve another LLM (except Higgs Audio 2 or derivatives), and supplies outputs/results as-is with no warranty. | No inspected source says who owns generated audio, grants a general commercial publishing right, or clears voice/personality/data claims. A CC-BY-NC model restriction should not be mechanically re-labelled as an output license, but it does mean the inference stack is not commercially cleared. |
| Voice profile / reference audio | VoiceStudio's public project guidance says model weights, voices, and generated output have their own licenses and says a voice should be cloned only with its owner's permission. | The local synthetic Aethera seed/design has no real-person reference, but the upstream source does not grant a general right to use arbitrary voice identities or recordings. Provenance, consent, and any voice-specific terms must be recorded separately. |
| Local API | The official API is a local, loopback service with no account or hosted service required; it describes transport and locality. | Local execution does not change the licenses of the app, model, tokenizer, voice, or output. |

## OmniVoice / VoiceStudio source audit

### VoiceStudio application and inference path

The upstream [VoiceStudio license notice](https://github.com/debpalash/VoiceStudio/blob/main/LICENSE-NOTICE.md) is unusually explicit about scope: AGPL-3.0 covers the Electron/web app, native helper, backend, CLI, and packaging files; the notice says commercial and internal business use of the application is allowed under AGPL. It also states that proprietary embedding without AGPL copyleft obligations is the use case for a separate commercial license. The binding text is the repository's [AGPL-3.0 `LICENSE`](https://github.com/debpalash/VoiceStudio/blob/main/LICENSE).

The same notice explicitly says that model weights, tokenizers, and other third-party assets keep their own terms; a VoiceStudio commercial license would not replace those terms. It also says its model-inventory fields distinguish commercial model use, commercial output use, redistribution, and voice/recording consent, and that an `unknown` assessment is not permission. This is the correct legal-layer model for the audit. The upstream [README's responsible-use note](https://github.com/debpalash/VoiceStudio/blob/main/README.md) separately says to clone a voice only with its owner's permission.

The [local API documentation](https://voicestudio.sh/docs/local-api) confirms a local-only API on `http://localhost:3900`, with no account or cloud connection required. The [speech API reference](https://voicestudio.sh/docs/api-reference/audio) describes generation parameters and lists engine IDs, but it is an API contract, not a grant of model, voice, or output rights.

### OmniVoice code and pretrained weights

The official [OmniVoice model card](https://huggingface.co/k2-fsa/OmniVoice/blob/main/README.md) states:

1. code: Apache 2.0;
2. pretrained model: CC-BY-NC because of training-data constraints; and
3. no unauthorized voice cloning, impersonation, fraud, scams, or other illegal/unethical use.

The card's `CC-BY-NC` label has no version suffix in the source reviewed. Do not silently expand it to “CC BY-NC 4.0,” and do not treat the Apache code license as the weights license. The [upstream OmniVoice `LICENSE`](https://github.com/k2-fsa/OmniVoice/blob/master/LICENSE) is the code-layer reference.

The card demonstrates zero-shot voice cloning and voice-design features, but demonstration of a capability is not permission to use a person's voice. For this project, the safer local design is the existing synthetic seed/instruction path without a real-person reference. That still leaves the CC-BY-NC model restriction in place.

### Bundled audio tokenizer

The distributed [OmniVoice `audio_tokenizer/LICENSE`](https://huggingface.co/k2-fsa/OmniVoice/blob/main/audio_tokenizer/LICENSE) is not Apache or CC-BY-NC. It is the **BOSON HIGGS AUDIO 2 COMMUNITY LICENSE AGREEMENT**, dated June 20, 2025, based on and incorporating the [Meta Llama 3 Community License](https://llama.meta.com/llama3/license/).

Important explicit terms in the inspected license:

- grant is non-exclusive, worldwide, non-transferable, royalty-free, and limited;
- covered-material/product/service redistribution requires supplying the Boson and Meta terms and displaying the specified Higgs/Meta attribution;
- if the materials are used to create, modify, enhance, train, fine-tune, or improve a distributed AI model/software, the resulting model/software name must begin with “Higgs Audio 2”;
- Higgs Materials or their outputs/results may not be used to improve another LLM, except Higgs Audio 2 or derivative works;
- use must comply with law and the incorporated Meta Llama acceptable-use policy;
- products/services over 100,000 annual active users require an expanded Boson license before exercising the relevant rights;
- the materials and output/results are supplied as-is without warranties, and the user is responsible for deciding whether use or redistribution is appropriate; and
- no trademark license is granted except the narrow use required by the agreement.

These terms do not themselves state that every generated WAV/MP3 is non-commercial. They do, however, impose conditions on the tokenizer/materials and leave output ownership/clearance unresolved. Because the same inference stack also uses CC-BY-NC OmniVoice weights, the practical commercial decision remains “not cleared.”

### Generated audio and commercial output

The sources reviewed do **not** contain an affirmative statement equivalent to “you own the output,” “you may commercially exploit all generated audio,” or “outputs are unencumbered.” The tokenizer's warranty/assumption-of-risk language is not an output-rights grant. The VoiceStudio notice expressly warns that commercial output use is a separate inventory field and that unknown is not permission.

This yields three distinct statements:

- **Explicit:** the pretrained model is labeled CC-BY-NC; the tokenizer restricts certain use of materials/outputs and has commercial-volume conditions; VoiceStudio's app is AGPL.
- **Not explicit:** a general output license, ownership assignment, warranty of non-infringement, or commercial publication permission for a generated voice file.
- **Inference:** even if a copyright analysis later concludes that a particular output is not protected or is not a derivative work, that would not retroactively authorize commercial use of a restricted model/tokenizer or resolve voice/personality, contractual, privacy, or publicity claims.

## Local project evidence

Read-only inspection of `C:\dev\neuralbridge-studio` found:

- `docs/aethera/STATUS.md` records that the installed VoiceStudio TTS is OmniVoice, with `commercial_inference: restricted` and `commercial_outputs` / `voice_rights` unknown.
- The same file records the Aethera channel voice as a seed/instruction design with no reference-audio cloning and marks OmniVoice scope as `noncommercial`.
- `docs/THIRD-PARTY.md` says VoiceStudio is an external optional provider, not bundled or distributed by NeuralBridge, and requires separate review of app, model, voice, and output.
- `packages/local-worker/pyproject.toml` has no TTS dependencies.
- The root `package.json` has no Kokoro, Piper, Chatterbox, or other local TTS package. The existing Windows speech fallback and manual ElevenLabs path are product fallbacks, not a completed commercial-license audit.

No Rights Manager row, manifest, product-code file, or model asset was changed for this research.

## Commercially clearer local/self-hosted alternatives

The candidates below are realistic integration targets, not a final legal opinion. In all cases, preserve the exact model revision, license files, model card, dependency notices, and voice asset provenance. “Commercially clearer” means the model/engine license is materially more explicit than OmniVoice's CC-BY-NC position; it does **not** mean that every generated file is guaranteed to have a copyright or personality-rights clearance.

### 1. Kokoro-82M — strongest first prototype for a fixed synthetic PT-BR voice

**Primary sources:** [official model card](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/README.md) and [official voice table](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md).

- The model card labels the weights Apache-2.0 and explicitly says Kokoro can be deployed in production and commercial APIs.
- Official voice metadata lists Brazilian Portuguese (`pt-BR`) with two male voices, `pm_alex` and `pm_santa`, plus one female voice.
- It is a fixed-voice design path: no real-person reference audio is needed, which matches the “synthetic identity, no real-person cloning” requirement.
- It is small enough for practical local inference and exposes speed/control through the normal pipeline; it is a reasonable fit for natural, young, dynamic narration after text chunking and prosody tuning.
- Caveats: the official voice table warns that non-English support can be thin and that very short/very long utterances can degrade; the PT-BR voice table does not give a separate voice-specific commercial license or an output-ownership clause. The model card lists CC-BY training datasets used in v1.0, so retain the model's attribution/acknowledgement information and audit the exact release before redistribution.

**Commercial posture:** model weights are explicitly permissive; output rights are not separately promised. **Recommended first technical/legal prototype.**

### 2. Piper — best low-resource/CPU option, with GPL and voice-chain discipline

**Primary sources:** [Piper engine repository](https://github.com/OHF-Voice/piper1-gpl), [voice licensing guidance](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/LICENSING.md), [commercial-use voice list](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/COMMERCIAL_USE.md), and the [PT-BR `cadu` model card](https://huggingface.co/rhasspy/piper-voices/blob/main/pt/pt_BR/cadu/medium/MODEL_CARD) / [PT-BR `jeff` model card](https://huggingface.co/rhasspy/piper-voices/blob/main/pt/pt_BR/jeff/medium/MODEL_CARD).

- The current Piper engine is GPL-3.0-or-later. That is commercial-use-capable software, but it carries copyleft obligations that matter if bundled or linked into a proprietary product. Process isolation or a separate service may change the engineering analysis, not the need for legal review.
- Piper's project makes no license grant of its own over voice models. Rights come from each voice's training data and trainer, and the project says model cards must be followed.
- The current commercial-use list includes `pt_BR-cadu-medium` and `pt_BR-jeff-medium` as voices whose complete training chains use commercially permissive recordings, with CC0 listed for the PT-BR dataset and the CC0 `rdh` base. These are practical male-voice candidates by voice identity/name, but the official metadata does not make gender a legal guarantee; audition the exact files.
- It is fast, local, and straightforward to integrate, but usually less expressive/dynamic than Kokoro or Chatterbox. Prosody can be shaped with text, punctuation, speed, and post-processing rather than reference cloning.
- Caveats: Piper says retraining is ongoing and that a previously downloaded file with the same name may have a different training chain. Pin the exact model-card revision/hash, ship its `MODEL_CARD`, and do not use a lessac-derived copy merely because the filename matches a listed voice.

**Commercial posture:** model-chain evidence is clearer for the listed PT-BR voices than for ordinary Piper voices; engine GPL obligations remain. **Good CPU fallback if the packaging model is legally acceptable.**

### 3. Chatterbox Multilingual V3 PT-BR — strongest expressive option, but not the safest long-term dependency

**Primary sources:** [official Chatterbox model card](https://huggingface.co/ResembleAI/chatterbox/blob/main/README.md), [PT-BR single-language model card](https://huggingface.co/ResembleAI/Chatterbox-Multilingual-pt-br/blob/main/README.md), and [MIT license](https://github.com/resemble-ai/chatterbox/blob/master/LICENSE).

- The code and official model cards are MIT-licensed; the dedicated PT-BR model is explicitly optimized for Brazilian Portuguese, and the general V3 card documents expressive controls and a 23-language family.
- The model produces watermarked audio using Resemble's Perth watermarker. That is a provenance/operational characteristic, not a commercial restriction in the MIT license.
- It can sound natural, dynamic, and conversational, but its strongest identity controls are voice-cloning/reference-prompt controls. For this project, do not supply a real person's recording; use a synthetic/owned reference only if one is separately cleared, or prefer a fixed-voice candidate.
- Caveats: the upstream README says the project was retired in August 2026 and is no longer maintained. It also needs materially more compute than Piper/Kokoro and the PT-BR single-language model is large. The MIT model/code license does not contain a bespoke output-ownership grant; audit all bundled dependencies and the watermarker before redistribution.

**Commercial posture:** permissive code/model license and explicit PT-BR model, but maintenance, reference-voice, dependency, and output-rights caveats make it a secondary candidate. **Use for an expressive prototype, not as the default production dependency without an ownership/maintenance decision.**

## Recommendation

1. Prototype **Kokoro-82M v1.0** with `pm_alex` and `pm_santa`, no reference audio, exact model hash, and a local attribution bundle. Test PT-BR pronunciation, short interjections, 30–90 second paragraphs, speed variation, and emotional direction through punctuation/text structure.
2. Keep **Piper `pt_BR-cadu-medium` or `pt_BR-jeff-medium`** as the lightweight fallback only after pinning the current commercial-chain model card and choosing an integration shape compatible with GPL-3.0-or-later.
3. Treat **Chatterbox PT-BR** as an expressive research candidate. Do not use it to clone a real person; its retirement and reference-voice design make it a weaker production choice despite the MIT label.
4. Before any monetized publication, obtain a human/legal decision that separately covers: application/runtime, model weights, tokenizer or other model components, fixed voice or reference voice, generated audio use/distribution, and any redistribution of model files. Record the exact evidence and revision; “Apache/MIT/GPL” on one layer is not a clearance for the other layers.

## Source and status notes

This report uses official upstream repositories, model cards, licenses, and documentation as primary sources, plus read-only local project documentation. It is an evidence audit, not legal advice. Unknown means “not established by the reviewed source,” not “definitely prohibited”; explicit non-commercial or conditional terms remain binding until superseded by a written license or authoritative revision.

## User decision after audit

On 2026-11-11 the user decided to keep the current Aethera/OmniVoice voice for a strictly non-commercial channel: no monetization, sponsorships, or commercial exploitation. Kokoro, Piper, and Chatterbox are not to be implemented or integrated at this time. The existing VoiceStudio configuration and license checks remain in force, and the Rights Manager is unchanged. This decision does not clear OmniVoice for commercial use; it defines the permitted project scope as non-commercial only.
