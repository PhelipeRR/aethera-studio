# Aethera — amostras de motores comerciais em avaliação

Data: 2026-11-11. As amostras abaixo são apenas para comparação. O preset oficial `aethera-voz-dinamica` não foi alterado, nenhuma autorização foi revogada e nenhum Rights Manager foi modificado.

Texto idêntico usado nas três amostras, sem áudio de referência e sem clonagem de pessoa real:

> Três jogos, três maneiras de transformar uma derrota em aula. A cidade pode te guiar, o cenário pode esconder a pista e, quando tudo dá errado, pelo menos o botão de repetir ainda não pediu seu cartão de crédito.

## Amostras

Arquivos em `C:/Users/Pheli/Documents/ChatGPT/Videos/vozes/amostras-aethera/comparacao-comercial-2026-11-11/`:

| Motor | Voz/configuração | Duração | SHA-256 | Licença/evidência | Limite atual |
|---|---|---:|---|---|---|
| Kokoro-82M | `pm_alex`, PT-BR, speed 1.0 | 12,672 s | `53A10C2050892E5AA732F7B58574DA3CE14FCBA514E2D2475F75DC24E1D3A541` | Pesos Apache-2.0 e tabela oficial de vozes PT-BR em [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/README.md) e [VOICES.md](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md) | Saída/voz não têm concessão comercial independente explícita; fixar hash e atribuições antes de publicar. |
| Piper | `pt_BR-cadu-medium`, speaker 0 | 12,863 s | `E6D95BC25106B0C27714FFA307BCDEBD20A6B82E608ADFC774A36CE0822DF54F` | Engine GPL-3.0-or-later; a [lista comercial oficial](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/COMMERCIAL_USE.md) e o [model card PT-BR](https://huggingface.co/rhasspy/piper-voices/blob/main/pt/pt_BR/cadu/medium/MODEL_CARD) documentam a cadeia CC0 desta voz | GPL exige decisão de empacotamento; voz/output ainda precisam de atribuição e auditoria do hash exato. |
| Chatterbox Multilingual | `language_id=pt`, exaggeration 0.65, cfg 0.45, voz interna do modelo | 11,880 s | `2B0DEBF343F6353D98CF371D041FB72918FA91F1ADE7BE29AF6325C04FBF47A8` | Código/modelo MIT no [model card oficial](https://huggingface.co/ResembleAI/chatterbox/blob/main/README.md) e [licença](https://github.com/resemble-ai/chatterbox/blob/master/LICENSE); áudio leva marca d’água Perth | Projeto upstream foi aposentado; exige revisão de dependências, manutenção e direitos de output antes de produção. |

## Inventário local

- VoiceStudio 0.5.7 tem apenas OmniVoice instalado como TTS; sua avaliação local continua `commercial_inference: restricted`, `commercial_outputs: unknown` e `voice_rights: unknown`.
- O ambiente Python já tinha `kokoro-onnx` e `qwen-tts`; Qwen não foi escolhido para esta rodada porque seus termos completos de pesos, voz e outputs não foram auditados neste relatório.
- O catálogo local lista MOSS-TTS-Nano, VoxCPM2 e CosyVoice 3 como integráveis, mas seus registros locais estão `unreviewed`/`commercial_inference: unknown`; não foram tratados como liberados nem usados para amostras.

## Decisão provisória

Kokoro é o primeiro candidato técnico para preservar uma voz masculina PT-BR sintética, natural e sem clonagem. Piper é o fallback leve, condicionado à aceitação das obrigações GPL. Chatterbox é o candidato mais expressivo, mas fica atrás por aposentadoria do upstream e por depender de uma revisão adicional de outputs/dependências.

Nenhum candidato foi promovido a voz oficial. A escolha comercial exige aprovação humana e registro separado de runtime, pesos, voz, tokenizer/dependências e direitos dos arquivos gerados.

Fontes completas e distinção entre pesos, software, tokenizer e outputs: [voice-engine-commercial-audit-2026-11-11.md](voice-engine-commercial-audit-2026-11-11.md).
