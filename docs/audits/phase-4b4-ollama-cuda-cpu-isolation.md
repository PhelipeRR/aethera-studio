# Fase 4B.4 — Isolamento da falha CUDA/CPU do Ollama (qwen2.5vl:3b)

Data: 2026-11-23 · Modo: `audit` (video-pipeline-auditor v3 + G10 Token Budget) · Commit base: `7569ec1`

## Escopo e modo
- Uma única chamada real e direta a `POST http://127.0.0.1:11434/api/chat`, sem passar pelo Aethera.
- Ambiente: Windows 11, Ollama **0.40.16**, modelo `qwen2.5vl:3b` (id `fb90415cde1e`, 3.2 GB), RTX 4060 Ti 8 GB (driver 621.01, backend `cuda_v13`), CPU com AVX-512 (`ggml-cpu-zen4.dll`), 32 GB RAM.
- Nada atualizado ou baixado; nenhum arquivo do Aethera/adapter do Recap alterado; nenhuma API externa, TTS, MotionVelix, render ou painel real processado.
- Variáveis `OLLAMA_MAX_LOADED_MODELS` e `OLLAMA_NUM_PARALLEL` existem no ambiente e não foram tocadas.

## 1. Resultado CPU vs. GPU

| Caminho | Evidência | Resultado |
| --- | --- | --- |
| **CPU** (`num_gpu: 0`, esta fase) | chamada única de 19:52:11–19:52:26 | **PASS**: HTTP 200, `done=true`, `done_reason=stop`, descrição visual correta |
| **GPU** (execuções anteriores, 19:03–19:31) | `server.log`: `CLIP using CUDA0 backend`, `offloaded 37/37 layers to GPU` | **FAIL**: 2× `Unexpected empty grammar stack after accepting piece: @ (31)` (19:05:10 e 19:23:49), 1× HTTP 500 depois do decode da imagem (19:28:21), runner encerrado com `exit status 1` (19:10:59, 19:36:06) |

Observação: as chamadas GPU anteriores usaram parâmetros diferentes (algumas com JSON mode/grammar e prompts maiores; duas falharam só por exceder `num_ctx`). Pela restrição de chamada única, **não houve controle GPU com a mesma entrada nesta fase**.

## 2. Dispositivo do encoder visual (confirmado, não presumido)
`num_gpu: 0` move o projetor para a CPU no Ollama 0.40.16. Linhas do `server.log`:

```
msg="disabling multimodal projector offload" reason=cpu-only
llama-server.exe ... --mmproj <blob> --no-mmproj-offload ... -ngl 0 ...
load_backend: loaded CPU backend from ...\ggml-cpu-zen4.dll   (nenhum backend CUDA carregado)
load_tensors: CPU model buffer size = 568.78 MiB / CPU_REPACK = 1265.91 MiB
llama_kv_cache: CPU KV buffer size = 144.00 MiB
clip_ctx: CLIP using CPU backend
reserve_compute_meta: CPU compute buffer size = 569.70 MiB
image decoded (batch 1/2) in 1434 ms
image decoded (batch 2/2) in 1511 ms
```

Na execução GPU, as linhas equivalentes eram `CLIP using CUDA0 backend` e `CUDA0 compute buffer size = 569.70 MiB`. Ressalva: o Ollama só desativa o offload do projetor quando a execução é **toda em CPU** (`reason=cpu-only`). Esta fase não isola "LLM na GPU + encoder na CPU".

## 3. Resposta visual produzida
Imagem sintética 128×128 PNG: fundo branco, quadrado vermelho à esquerda e quadrado azul à direita.

> "A imagem mostra dois quadrados retangulares. O quadrado à esquerda é vermelho e o quadrado à direita é azul."

A resposta é coerente e correta na cor, na quantidade e na posição. Não aparece o padrão `@` visto na GPU.

## 4. Tokens, duração, RAM e VRAM

| Métrica | Valor |
| --- | --- |
| `prompt_eval_count` (entrada) | 1058 tokens (~1024 de imagem por causa de `--image-min-tokens 1024`, mesmo numa imagem de 128 px) |
| `eval_count` (saída) | 33 tokens |
| `total_duration` | 15 546 ms (wall 15 572 ms) |
| `load_duration` (cold) | 5 609 ms |
| `prompt_eval_duration` (encoder + prefill) | 8 480 ms, dos quais ~2,9 s são o decode da imagem |
| `eval_duration` | 1 447 ms (~22,8 tok/s) |
| VRAM | 1961 → pico 1962 MiB (linha de base de outros processos; o runner não usou a GPU), utilização da GPU ≤ 1% |
| RAM | working set do `llama-server` com pico de 3 804 MiB; RAM livre do sistema 14 828 → mínimo 10 838 MiB |
| Resposta bruta | 444 bytes, sem truncamento (limite de 1 MiB) |

G10: `panels_total=1` (sintético), `model_calls=1`, `retry_calls=0`, `quota_events=0`, `estimated_cost=0` (local), `cache_read/write_tokens=não medido`, `stop_reason=stop`.

## 5. Logs relevantes
- GPU, 19:05:10 e 19:23:49: `got exception: Unexpected empty grammar stack after accepting piece: @ (31)`. O sampler gera o token `@` repetido e a grammar JSON quebra. É um sintoma típico de logits degenerados.
- GPU, 19:28:21: `500 | 1.52s` logo depois de `image decoded (batch 3/3)`, sem mensagem de erro no servidor.
- 19:10:59 e 19:36:06: `llama-server terminated error="exit status 1"`, ocorrido em momentos de ociosidade/descarregamento. A relação com a falha não foi confirmada.
- 19:03 e 19:05: `request (4109|16173 tokens) exceeds the available context size (4096 tokens)`. Isso é um problema de orçamento de contexto, separado da falha CUDA.

## 6. Causa raiz
- **Confirmado:** o modelo, os pesos GGUF, o template e o runtime 0.40.16 produzem visão correta quando o encoder e o LLM rodam em CPU. Isso descarta incompatibilidade geral entre modelo e runtime.
- **Forte evidência, ainda não confirmada:** a falha está no caminho CUDA (CLIP em `CUDA0` e/ou LLM com 37/37 camadas na GPU, `flash-attn auto`, `cuda_v13`).
- **Hipóteses restantes:**
  - H1: o encoder qwen2.5-VL no CUDA gera NaN/Inf, que se propagam como token `@`.
  - H2: `--flash-attn auto` no CUDA com a atenção em janela do qwen2.5-VL.
  - H3: o LLM na GPU gera logits degenerados mesmo com embeddings corretos.
  - H4: o 500 de 19:28 tem outra causa, já que nenhuma mensagem foi registrada.
- Para fechar a causa: uma chamada GPU de controle com a mesma imagem e os mesmos parâmetros, mudando só `num_gpu`. Depois, se reproduzir, uma chamada com `OLLAMA_FLASH_ATTENTION=0` para testar H2.

## 7. Workaround mínimo
- **Imediato e comprovado:** `options.num_gpu = 0` por requisição, só no caminho de visão local. Não é padrão: custa ~10 s por painel com o modelo quente (8,5 s de prefill + ~1,5 s de geração) e ~1058 tokens de entrada por painel.
- **A testar (específico do Ollama, sem tocar no Aethera):** `OLLAMA_FLASH_ATTENTION=0` com a GPU. Isso exige reiniciar o servidor Ollama, o que é uma mudança de configuração e precisa da aprovação do usuário.
- **Fora de alcance:** "LLM na GPU + encoder na CPU". O Ollama 0.40.16 só emite `--no-mmproj-offload` no modo cpu-only.

## Gates

| Gate | Status | Evidência / motivo |
| --- | --- | --- |
| G1 Evidência | PASS (parcial) | CPU confirmada por logs; GPU com evidência histórica, sem controle de mesma entrada |
| G2 Patch | N/A | modo audit, nenhum código alterado |
| G3 Testes | N/A | sem patch |
| G4–G7, G9 | N/A | sem render nem timeline |
| G6 Recursos | PASS | o runner subiu em CPU e liberou ao terminar; nenhum processo órfão foi iniciado pelo cliente |
| G8 Resiliência | PASS | zero retries e zero fallback; timeout de 480 s com `AbortSignal` |
| G10 Token Budget | PASS | 1 chamada, contabilizada; captura limitada a 1 MiB em arquivo, sem despejar NDJSON no terminal |

## Execução
- Cliente: `scratchpad/p4b4/cpu-probe.mjs` (Node 24, fora do repositório). Grava `response.raw` com limite de 1 MiB, `result.json` e `samples.json` (amostras a cada 1 s via `nvidia-smi`/`tasklist`). No terminal, imprime só o resumo.
- Trecho do log de servidor desta chamada salvo em `scratchpad/p4b4/run1/server-log-slice.txt`.
- Não executados: chamada de controle GPU e teste com flash-attn desligado, por causa da restrição de chamada única.

## Recomendação para retomar a Fase 4B
1. Com autorização: rodar **uma** chamada GPU de controle com `synthetic.png` e parâmetros idênticos (`num_gpu` omitido). Se falhar com `@`/500, a causa CUDA fica confirmada.
2. Se confirmada: testar **uma** chamada GPU com `OLLAMA_FLASH_ATTENTION=0`, que exige reiniciar o Ollama.
3. Só depois disso escolher entre GPU com workaround, `num_gpu:0` restrito à visão (com benchmark de latência e qualidade em ~10 painéis reais deduplicados) ou outro modelo multimodal.
4. Independentemente do caminho, ajustar o orçamento: cada painel custa ≥ ~1058 tokens de entrada por causa de `image-min-tokens 1024`. Com `num_ctx 4096`, cabem no máximo ~3 imagens por requisição, o que explica os erros 4109/16173.
5. Atualizar o Ollama só como experimento controlado, se as duas hipóteses CUDA falharem.
