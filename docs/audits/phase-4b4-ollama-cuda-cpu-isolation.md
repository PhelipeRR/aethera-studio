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

## 6. Causa raiz (superada pelo Adendo 2)
- **Confirmado:** o modelo, os pesos GGUF, o template e o runtime 0.40.16 produzem visão correta quando o encoder e o LLM rodam em CPU. Isso descarta incompatibilidade geral entre modelo e runtime.
- **Forte evidência, ainda não confirmada:** a falha está no caminho CUDA (CLIP em `CUDA0` e/ou LLM com 37/37 camadas na GPU, `flash-attn auto`, `cuda_v13`).
- **Hipóteses restantes:**
  - H1: o encoder qwen2.5-VL no CUDA gera NaN/Inf, que se propagam como token `@`.
  - H2: `--flash-attn auto` no CUDA com a atenção em janela do qwen2.5-VL.
  - H3: o LLM na GPU gera logits degenerados mesmo com embeddings corretos.
  - H4: o 500 de 19:28 tem outra causa, já que nenhuma mensagem foi registrada.
- Para fechar a causa: uma chamada GPU de controle com a mesma imagem e os mesmos parâmetros, mudando só `num_gpu`. Depois, se reproduzir, uma chamada com `OLLAMA_FLASH_ATTENTION=0` para testar H2.

## 7. Workaround mínimo (superado pelo Adendo 2)
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
- Trecho do log de servidor desta chamada salvo em `scratchpad/p4b4/run1/server-log-slice.txt` (o log completo foi rotacionado para `server-1.log` às 20:08).
- Não executados: chamada de controle GPU e teste com flash-attn desligado, por causa da restrição de chamada única.

## Adendo — chamada de controle GPU (19:53:59): INVÁLIDA como controle
Mesma imagem e mesmos parâmetros, com `num_gpu` omitido. Resultado: HTTP 200, `done=true` e resposta idêntica. **Mas o log mostra que a chamada não rodou na GPU:**
- Nenhum `starting llama-server`: o runner CPU-only da chamada anterior (`-ngl 0 --no-mmproj-offload`) foi reaproveitado. `load_duration` foi de 2,8 ms e a VRAM ficou em 2126 MiB, sem mudança.
- `selected slot by LCP similarity, f_sim_best = 1.000` e `prompt eval time = 51.59 ms / 1 tokens`. O prompt com a imagem veio inteiro do cache, e o encoder não executou.

Consequências:
1. A falha CUDA continua **não reproduzida com a mesma entrada**. A causa segue como forte evidência, sem confirmação.
2. **Achado novo (P2):** omitir `num_gpu` não força um novo carregamento. Uma requisição com `num_gpu:0` deixa o modelo residente em CPU, e as requisições seguintes sem `num_gpu` rodam silenciosamente em CPU enquanto o modelo estiver carregado. Se o Aethera misturar os dois modos, a latência e o dispositivo ficam imprevisíveis.
3. Um controle válido exige antes descarregar o modelo (`ollama stop qwen2.5vl:3b`, sem inferência) e conferir no log `CLIP using CUDA0 backend`. Para evitar o cache de prompt, a imagem precisa ser nova ou o runner precisa ter sido recarregado.

## Adendo 2 — controle GPU válido (19:54:47): PASS, hipótese CUDA refutada para esta entrada
Antes da chamada, o modelo foi descarregado (`ollama stop qwen2.5vl:3b`; `ollama ps` vazio, sem `llama-server`). Depois, uma única chamada com a mesma imagem e os mesmos parâmetros, `num_gpu` omitido.

| | CPU (19:52) | GPU (19:54) |
| --- | --- | --- |
| Runner | `-ngl 0 --no-mmproj-offload` | `--flash-attn auto`, sem `-ngl` (offload total) |
| Encoder | `CLIP using CPU backend` | `CLIP using CUDA0 backend`, `Flash Attention enabled` |
| LLM | CPU / CPU_REPACK | `offloaded 37/37 layers to GPU` |
| HTTP / done | 200 / `true` (`stop`) | 200 / `true` (`stop`) |
| Resposta | correta | **idêntica** e correta |
| Tokens (entrada/saída) | 1058 / 33 | 1058 / 33 (imagem codificada por inteiro, sem cache) |
| Load | 5 609 ms | 3 253 ms |
| Decode da imagem | ~2 945 ms | ~73 ms |
| Prefill | 8 480 ms | 663 ms (1595 tok/s) |
| Geração | 1 447 ms (~23 tok/s) | 352 ms (~94 tok/s) |
| Total | 15 546 ms | 4 277 ms (cold) |
| VRAM pico | sem uso | 6 102 MiB (de 2 075; ~4,0 GB do runner) |
| RAM do runner | 3 804 MiB | 842 MiB |

### Causa raiz revisada (substitui a seção 6)
- **Refutado:** "o caminho CUDA/flash-attn quebra a visão do qwen2.5vl:3b" como causa geral. Com a mesma entrada, GPU e CPU dão o mesmo resultado correto.
- **Confirmado:** modelo, runtime 0.40.16, CUDA (`cuda_v13`), encoder em CUDA0 e Flash Attention funcionam para uma imagem simples, sem JSON mode.
- **Hipóteses restantes** para as falhas anteriores. Todas as chamadas que falharam diferiam em mais de uma variável:
  - **H5 (mais forte):** saída estruturada com grammar (`format`/JSON mode). As duas falhas com `@` são exceções do grammar sampler (`Unexpected empty grammar stack after accepting piece: @`). Esse caminho nunca foi testado em CPU, então não há nada que o ligue ao dispositivo.
  - **H6:** conteúdo e tamanho de painéis reais (resolução, várias imagens por requisição). As chamadas de 4109 e 16173 tokens estouraram o `num_ctx`.
  - **H7:** o HTTP 500 de 19:28:21 não deixou mensagem no servidor. A causa é desconhecida, e o corpo da resposta do cliente daquela execução não foi preservado.
- **Workaround CPU (`num_gpu:0`) não recomendado:** é ~3,6× mais lento (15,5 s contra 4,3 s cold), sem ganho de qualidade.

### Recomendação revisada para retomar a Fase 4B
1. Manter a GPU. Não adotar `num_gpu:0` e não trocar o modelo por enquanto.
2. Isolar H5 com **uma** chamada GPU usando a mesma `synthetic.png` e os mesmos parâmetros, mudando só a adição de `format: "json"` (ou o schema que o adapter do Recap usa). Se falhar com `@`, a causa fica no grammar/JSON mode, e o workaround seria pedir texto e fazer o parse/validação no adapter, ou usar um schema mais simples.
3. Se H5 passar, isolar H6 com **um** painel real deduplicado, sem JSON e em GPU, e conferir os tokens de entrada com `num_ctx` folgado.
4. Corrigir o orçamento de contexto: cada imagem custa ≥ ~1058 tokens (`image-min-tokens 1024`). Com `num_ctx 4096`, cabem no máximo ~3 imagens por requisição.
5. Achado P2 (adendo 1): não misturar requisições com e sem `num_gpu` no mesmo modelo residente. Se algum dia houver um modo CPU, fixar `num_gpu` explicitamente em todas as chamadas.
6. Atualizar o Ollama deixou de ser necessário para esta falha.

## Adendo 3 — GPU + JSON mode (19:56:07): PASS; H5 sozinha não reproduz
Modelo descarregado antes. Uma única chamada, igual ao controle GPU válido, mudando só `format: 'json'`, que é o mesmo valor do adapter (`vision-providers.ts:545`).
- Log: `CLIP using CUDA0 backend`, `offloaded 37/37 layers to GPU`, `Flash Attention enabled`, imagem codificada por inteiro (1058 tokens, `prompt_eval_cached_count=0`). Sem `grammar`/`exception`.
- Resposta: HTTP 200, `done=true` (`stop`), `{ "red": "red", "blue": "blue" }`. O JSON é válido e o conteúdo é pobre porque o prompt não pedia estrutura, mas não aparece `@`.
- Métricas: 2 912 ms no total (2 130 de load cold, 640 de prefill, 134 de geração), 1058/15 tokens, pico de VRAM 6 103 MiB.

### Reexame das falhas originais (`server.log`)

| Hora | Tokens (total / texto) | Lotes de imagem | Resultado |
| --- | --- | --- | --- |
| 19:05:10 | 4036 / 36 (~4000 de imagem, a 60 tokens do `num_ctx`) | 8 | exceção `@` no **1º token** |
| 19:23:49 | 1974 / 263 (~1711 de imagem) | 4 | exceção `@` no **1º token** |
| 19:28:21 | 1070 / 34 | 3 | HTTP 500 sem mensagem (prompt idêntico com cache deu 200 às 19:31) |
| testes 4B.4 | 1058 / 34 (1024 de imagem) | 2 | PASS em CPU, GPU e GPU+JSON |

### Causa raiz revisada (substitui a do Adendo 2)
- O `@` é o **primeiro** token amostrado logo depois do prefill. Isso aponta para logits degenerados (NaN/Inf ou distribuição colapsada) depois do encoder, e não para um erro de grammar no meio da geração. A grammar só torna o problema visível.
- **H8 (mais forte agora):** a falha depende do **tamanho da imagem** (mais de ~1024 tokens, 4 ou mais lotes de 512, mais janelas na atenção em janela do qwen2.5-VL e sequências longas no Flash Attention). As imagens sintéticas da 4B.4 eram pequenas demais para reproduzir. **O isolamento CPU vs. GPU continua em aberto para imagens grandes**, porque a CPU nunca recebeu uma imagem com mais de 1024 tokens.
- H6 e H7 continuam abertas. H5 (JSON mode como causa isolada) não se reproduziu.

### Próxima isolação recomendada (até 2 chamadas)
1. Sintética grande, sem conteúdo protegido (por exemplo ~1000×1400 px, mirando ~1700 tokens de imagem, o mesmo da falha de 19:23), com GPU e `format:'json'` e `num_ctx 4096`. Se aparecer `@`, H8 se reproduz.
2. Se reproduzir: a mesma chamada com `num_gpu:0`, descarregando o modelo antes. Se a CPU passar, a falha é do caminho CUDA para imagens grandes, e o próximo passo seria testar `OLLAMA_FLASH_ATTENTION=0`. Se a CPU também falhar, a causa é modelo/runtime com imagens grandes, e a mitigação seria limitar a resolução do painel antes do envio.

## Adendo 4 — imagem sintética grande, GPU + JSON (19:59:53): PASS; H8 refutada para ~1715 tokens
Modelo descarregado antes. Uma única chamada com uma imagem sintética de 980×1372 px ("página" 2×3 com bordas pretas e uma forma colorida por painel), `format:'json'`, `num_ctx 4096`, `num_predict 128`, sem `num_gpu`. O prompt de texto é o mesmo dos testes anteriores.
- Log: `CLIP using CUDA0 backend`, `offloaded 37/37 layers to GPU`, `Flash Attention enabled`, `task.n_tokens = 1749` (1715 de imagem e 34 de texto), **4 lotes de imagem (512, 512, 512, 179)**. É a mesma estrutura da falha de 19:23 (4 lotes, o último com 175). Sem `grammar`/`exception`.
- Resposta: HTTP 200, `done=true` (`stop`), `{ "image": "https://www.example.com/image.jpg", "description": "A red circle, a blue square, a green circle, a yellow square, a purple circle, and an orange square." }`. As 6 formas e as 6 cores estão certas e na ordem. O campo `image` com URL foi inventado, um ponto fraco de qualidade do JSON livre.
- Métricas: 3 776 ms no total (2 127 de load cold, 1 245 de prefill a 1405 tok/s, 392 de geração), 1749/44 tokens, pico de VRAM de 6 107 MiB, GPU a 100%.
- A chamada em CPU **não foi feita**, porque a regra era só rodá-la se a GPU reproduzisse a falha.

### Estado da causa raiz
| Hipótese | Status |
| --- | --- |
| Caminho CUDA/flash-attn quebrado em geral | **refutada** (Adendos 2 a 4) |
| H5: JSON mode sozinho | **refutada** (Adendo 3) |
| H8: tamanho da imagem até ~1715 tokens / 4 lotes | **refutada** (este adendo) |
| H8b: imagem perto do limite de contexto (~4000 tokens, 8 lotes, 60 tokens livres, falha de 19:05) | aberta |
| H9: prompt real do adapter (263 tokens de texto com instruções de schema) | aberta, e é a diferença restante em relação à falha de 19:23 |
| H10: conteúdo de painel real (traço, retícula, texto) | aberta |
| H7: HTTP 500 de 19:28 sem mensagem | aberta |

Conclusão: **não há evidência de que a falha dependa do dispositivo.** Com prompt curto, o modelo funciona em GPU e em CPU, com e sem JSON mode, e com imagens de até ~1715 tokens. O `@` no primeiro token só apareceu com o prompt e as imagens reais do pipeline.

### Próxima isolação recomendada
1. Uma chamada GPU com a mesma imagem sintética grande e o **prompt exato do adapter** (texto e `format` iguais aos de `vision-providers.ts`), testando H9 sem conteúdo protegido.
2. Se passar: uma chamada GPU com **um** painel real deduplicado (H10), com `num_ctx` folgado e sem processar o lote.
3. Em qualquer caso, limitar a resolução do painel para que imagem + prompt + saída fiquem bem abaixo de `num_ctx`. A falha de 19:05 tinha só 60 tokens livres, e não há recuperação segura nessa situação.

## Adendo 5 — prompt exato do adapter, GPU (20:01:18): PASS; H9 refutada
Modelo descarregado antes. Uma única chamada com a mesma imagem sintética de 980×1372 px e o **prompt e o formato de requisição copiados literalmente** de `vision-providers.ts:519-548`: sem contexto narrativo (linha de fallback), `panel_id=synthetic-1 order=1 at_ms=0`, `format:'json'`, `num_ctx 4096`, `num_predict 1200` (padrão do adapter), `stream:false`, timeout de 120 s. O adapter não foi modificado.
- Log: `CLIP using CUDA0 backend`, `offloaded 37/37 layers to GPU`, `Flash Attention enabled`, 4 lotes de imagem (512, 512, 512, 179), `tokens: text = 230, total = 1945`. A falha de 19:23 tinha texto = 263 e total = 1974. Sem `grammar`/`exception`.
- Resultado: HTTP 200, `done=true` (`stop`). O JSON **faz parse** e traz todas as chaves do schema (`schemaVersion, nature, natureConfidence, description, frames, characters, actions, environment, overlays, limitations, confidence`).
- Métricas: 8 564 ms no total (2 471 de load cold, 1 264 de prefill a 1539 tok/s, 4 816 de geração para 536 tokens a 111 tok/s), pico de VRAM de 6 113 MiB, GPU a 98%.

### Qualidade da saída (achados P2 para o Recap, fora do escopo de dispositivo)
- `description` fala em "four squares", mas a imagem tem 6 painéis. A lista em `frames` traz as 6 formas corretamente.
- As formas aparecem em `characters` com `basis: "observed"`. Pelo prompt, deviam ficar fora de `characters` ou ter `basis=inferred`.
- Há posições erradas: o círculo roxo aparece como "bottom left", repetindo a posição do verde, e o retângulo laranja como "bottom right", repetindo a do amarelo.
- Os tipos não seguem o schema esperado: `schemaVersion: "1"` e as confianças (`"high"`) vêm como string, e `environment`/`overlays` vêm como a **string** `"null"`. `limitations` diz "No limitations provided.". Falta confirmar se `adaptLocalPanelAnalysis` normaliza ou rejeita esses tipos.

### Estado da causa raiz
| Hipótese | Status |
| --- | --- |
| Caminho CUDA/flash-attn | refutada |
| H5 JSON mode | refutada |
| H8 imagem de ~1715 tokens / 4 lotes | refutada |
| **H9 prompt do adapter** | **refutada** (230 tokens de texto; a variante de 263 tinha contexto narrativo) |
| H8b imagem perto do limite (~4000 tokens, 60 livres) | aberta |
| H10 conteúdo de painel real | aberta, é a principal diferença que sobra |
| H7 HTTP 500 de 19:28 | aberta |
| H11 estado do servidor (as falhas de 19:05 e 19:23 ocorreram em runners que depois terminaram com `exit status 1`) | aberta, ainda sem evidência |

**A falha `@` original não se reproduz com entradas sintéticas em nenhum dispositivo.** O dispositivo não é a causa provável. Trocar para CPU, atualizar o Ollama ou trocar o modelo continua sem justificativa.

### Próxima isolação recomendada
1. **Um** painel real deduplicado, o mesmo da falha de 19:23 se for identificável pelo checkpoint e sem reprocessar o lote, com o mesmo prompt e na GPU. Isso precisa de autorização explícita, porque envolve conteúdo real.
2. Se reproduzir o `@`: a mesma chamada com `num_gpu:0`, e só depois disso concluir sobre o dispositivo.
3. Independentemente do resultado: (a) limitar a resolução do painel para que imagem + prompt + 1200 de saída caibam em `num_ctx` (hoje ~1945 + 1200 = 3145 de 4096; uma imagem de ~4000 tokens nunca cabe); (b) avaliar se `adaptLocalPanelAnalysis` trata os tipos-string vistos acima.

## Adendo 6 — painel real, GPU, prompt do adapter (20:05:01): FAIL reproduzido
Escolha do painel: os 437 painéis de `nanomachine-cap-1-5/panels` foram perfilados apenas pelo cabeçalho do arquivo, sem nenhuma chamada de modelo: 437 únicos por sha256, tokens de imagem estimados p10/p50/p90/máx = 377/725/1334/**9106**, e 4 painéis acima de ~2600 tokens. `nanomachine-cap-1-5_p0_0.png` (800×1645) estima exatamente **1711** tokens de imagem, o mesmo valor da falha de 19:23. O painel foi lido sem cópia e não foi gravado em nenhum relatório.

Chamada: modelo descarregado antes, prompt e formato iguais aos do adapter (`panel_id=nanomachine-cap-1-5_p0_0`), `format:'json'`, `num_ctx 4096`, `num_predict 1200`, GPU.
- Log: `CLIP using CUDA0 backend`, `offloaded 37/37 layers to GPU`, `Flash Attention enabled`, lotes de imagem **512/512/512/175** (os mesmos de 19:23), `tokens: text = 238, total = 1949`, seguido de **`got exception: Unexpected empty grammar stack after accepting piece: @ (31)`** no primeiro token.
- Resposta HTTP: **200**, corpo bruto de 96 bytes: `{"model":"","created_at":"0001-01-01T00:00:00Z","message":{"role":"","content":""},"done":false}`.
- Métricas: 3 496 ms de wall, pico de VRAM de 6 128 MiB, 0 tokens gerados.

### Conclusões
- **Confirmado:** a falha depende do **conteúdo do painel**, já que imagens sintéticas do mesmo tamanho, com o mesmo prompt e no mesmo caminho GPU, passam. É determinística para `p0_0` e reprodutível.
- **Achado P1 (adapter):** o Ollama 0.40.16 sinaliza essa exceção com **HTTP 200** e envelope vazio (`done:false`, `content:""`). Em `vision-providers.ts:555-568`, `res.ok` passa e o erro vira "Ollama retornou JSON de análise inválido". O erro de runtime fica mascarado como saída ruim do modelo, o que é ruim para o diagnóstico e para a política de retry. O adapter deveria tratar `done !== true` ou `content === ''` como falha de provedor e não repetir a chamada às cegas.
- **Ainda em aberto:** CPU vs. GPU **para este painel**. Esse é o teste decisivo que falta.

## Adendo 7 — mesmo painel real em CPU (20:05:54): PASS. Causa isolada no caminho CUDA, dependente do conteúdo
Modelo descarregado antes. Mesma chamada do Adendo 6 (painel `p0_0`, prompt e formato do adapter, `format:'json'`, `num_ctx 4096`, `num_predict 1200`), mudando **só** `num_gpu: 0`.
- Log: `disabling multimodal projector offload reason=cpu-only`, apenas `CPU backend` carregado, `CLIP using CPU backend`, lotes de imagem **512/512/512/175** (os mesmos da falha), `tokens: text = 238, total = 1949`. Sem `grammar`/`exception`.
- Resposta: HTTP 200, `done=true` (`stop`). O JSON faz parse e tem todas as chaves do schema.
- Conteúdo, conferido visualmente contra o painel: cena noturna, lua, montanhas escarpadas com névoa e vegetação. **Coerente.** Imprecisões menores: lua em "center" (está no alto à direita), `weather: "clear"` (há nuvens), `characters` traz uma entrada "Unknown" em vez de lista vazia e `environment` vem com aninhamento livre fora de schema.
- Métricas: total de 36 872 ms (load 2 057, prefill 15 571 a 125 tok/s, dos quais ~4,9 s são o decode da imagem; geração 19 185 para 411 tokens a 21 tok/s). VRAM sem uso (2080 → 2082). RAM do runner com pico de 3 946 MiB; RAM livre caiu de 14 648 para 10 816 MiB.

### Resultado final da Fase 4B.4

| Entrada | GPU (CUDA0, flash-attn) | CPU |
| --- | --- | --- |
| Sintética 128 px, prompt curto | PASS | PASS |
| Sintética 128 px + JSON | PASS | — |
| Sintética 980×1372 + JSON | PASS | — |
| Sintética 980×1372 + prompt do adapter | PASS | — |
| **Painel real `p0_0` + prompt do adapter** | **FAIL** (`@` no 1º token, HTTP 200 vazio) | **PASS** |

**Causa raiz:** confirmada no caminho de execução CUDA do Ollama 0.40.16 / `cuda_v13` para certos conteúdos de imagem. Com a mesma entrada byte a byte, só o dispositivo muda o resultado. O primeiro token sai degenerado (`@`, id 31) logo depois do prefill, o que é compatível com NaN/overflow numérico em fp16. O painel que falha é escuro, de baixo contraste, com gradientes de névoa.
**Componente exato ainda não separado:** o encoder CLIP em CUDA, o LLM em CUDA ou o Flash Attention. O Ollama não permite "LLM na GPU + CLIP na CPU" (`--no-mmproj-offload` só existe no modo cpu-only), então a próxima separação possível é desligar o Flash Attention.

### Workaround mínimo
1. **Imediato (sem mudar o Aethera por enquanto):** marcar o painel como `needs_review`/fallback quando o envelope vier com `done:false` ou `content:""`, em vez de repetir a chamada. Isso exige o patch P1 abaixo, que precisa de autorização.
2. **A testar (1 chamada):** `OLLAMA_FLASH_ATTENTION=0` com reinício do servidor Ollama, e o mesmo painel `p0_0` na GPU. Se passar, é um workaround global barato que mantém a GPU. Precisa de autorização, porque muda a configuração do Ollama.
3. **CPU como padrão: não recomendado.** ~37 s por painel (contra ~4–9 s na GPU) daria cerca de 4,5 h para 437 painéis. Pode servir como **fallback por painel** só para os que falharem na GPU, com limite de painéis e de tempo.
4. **Atualizar o Ollama:** candidato controlado se o passo 2 não resolver, já que o bug está no backend CUDA/ggml, que muda entre versões.

### Recomendação para retomar a Fase 4B
1. Testar `OLLAMA_FLASH_ATTENTION=0` com `p0_0` (1 chamada, depois de autorizar o reinício).
2. Patch P1 no adapter (`vision-providers.ts`): tratar `done !== true` ou conteúdo vazio como falha de provedor classificada (`OLLAMA_RUNTIME_DEGENERATE_OUTPUT`), sem retry na GPU, com fallback opcional para CPU nesse painel. Incluir teste unitário com o envelope de 96 bytes capturado.
3. Limitar a resolução dos painéis antes do envio: 4 dos 437 passam de ~2600 tokens de imagem e não cabem com `num_predict 1200`; o máximo é ~9106.
4. Só depois disso fazer um piloto com ~10 painéis reais deduplicados, medindo a taxa de falha na GPU, antes de processar os 437.

## Adendo 8 — painel real na GPU com Flash Attention desligado (20:07:46): FAIL. H2 refutada
Procedimento: `ollama app.exe` e o servidor foram parados. Um `ollama serve` temporário subiu com `OLLAMA_FLASH_ATTENTION=0` definido **só no ambiente desse processo**, com logs em `scratchpad/p4b4/run9-gpu-real-panel-noFA/serve.err.log`. Depois do teste, o servidor temporário foi encerrado e o `ollama app.exe` original foi reaberto. Nenhuma variável persistente de usuário ou máquina foi alterada (`OLLAMA_FLASH_ATTENTION` de usuário continua vazia). O servidor restaurado (0.40.16) imprime a mesma configuração de 18:59. Com o reinício, o log anterior foi rotacionado para `%LOCALAPPDATA%\Ollama\server-1.log`, onde estão as evidências dos Adendos 1–7.

Chamada: idêntica à do Adendo 6 (painel `p0_0`, prompt e formato do adapter, `format:'json'`, `num_ctx 4096`, `num_predict 1200`, GPU).
- Log: `llama_context: flash_attn = disabled`, `warmup: flash attention is disabled`, `offloaded 37/37 layers to GPU`, `CLIP using CUDA0 backend` (sem FA, o buffer de compute do CLIP sobe de 569,7 para **4 871,57 MiB**), lotes 512/512/512/175, `tokens: text = 238, total = 1949`, seguido de **`got exception: Unexpected empty grammar stack after accepting piece: @ (31)`**.
- Resposta: HTTP 200, o mesmo envelope vazio de 96 bytes (`done:false`).
- Métricas: 32 044 ms de wall (quase tudo load/reserve do buffer de 4,9 GB), **pico de VRAM de 7 367 MiB** (de 8 188), RAM do runner com pico de 4 257 MiB.

### Conclusão atualizada
| Hipótese | Status |
| --- | --- |
| Dispositivo (CUDA vs. CPU) | **confirmado**: mesmo byte a byte, falha na GPU e passa na CPU |
| H2: Flash Attention | **refutada**: falha também com FA desligado |
| Componente CUDA: encoder CLIP vs. LLM | **não separável no Ollama 0.40.16** (`--no-mmproj-offload` só existe em cpu-only) |

Desligar o FA **não serve** como workaround: não corrige a falha, aumenta a VRAM em ~1,3 GB (perto do limite de 8 GB) e deixa o load muito mais lento.

### Recomendação revisada para retomar a Fase 4B
1. **Patch P1 no adapter** (precisa de autorização): tratar `done !== true` ou `content === ''` como `OLLAMA_RUNTIME_DEGENERATE_OUTPUT`, sem retry na GPU, com fallback **por painel** para `num_gpu:0`, limitado em quantidade e tempo (~37 s por painel). Teste unitário com o envelope de 96 bytes. Como `num_gpu:0` deixa o modelo residente em CPU (Adendo 1), o fallback deve sempre fixar `num_gpu` explicitamente nas duas rotas.
2. **Piloto de ~10 painéis reais deduplicados na GPU** para medir a taxa de falha. Se ela for baixa, a GPU continua como padrão e o fallback CPU fica só para os painéis que falharem. Se for alta, partir para o passo 3.
3. **Experimento controlado de runtime:** testar outra versão do Ollama/ggml (o bug está no backend CUDA) ou outro modelo multimodal local, usando `p0_0` como caso de regressão. Isso exige autorização, porque envolve download ou atualização.
4. Limitar a resolução dos painéis (4/437 passam de ~2600 tokens de imagem).

## Adendo 9 — Patch P1 no adapter (modo `fix`), aplicado e **não commitado**
**Correção do Adendo 6:** no working tree atual, `readOllamaChatResponse` (`vision-providers.ts`) **já rejeitava** `done !== true`, com a mensagem "resposta incompleta". O envelope de 96 bytes **não** virava "JSON de análise inválido". Essa afirmação foi baseada só nas linhas 555-568 e estava errada. O defeito real era outro: a falha não tinha classificação nem caminho de recuperação.

Mudanças em `packages/orchestrator/src/aethera/vision-providers.ts`:
- `OLLAMA_RUNTIME_DEGENERATE_OUTPUT` e `OllamaDegenerateOutputError` (`code`) foram exportados. `done !== true` **com conteúdo vazio** (JSON único ou NDJSON sem evento final) passa a lançar esse erro classificado. A mensagem anterior foi preservada como sufixo, e `done:false` com conteúdo parcial continua sendo um erro genérico.
- Fallback CPU **por painel**, **opt-in**: opção `cpuFallbackOnDegenerateOutput` ou env `NB_LOCAL_VLM_CPU_FALLBACK=1`. **O padrão é desligado.** Funcionamento:
  - Só é acionado por `OllamaDegenerateOutputError`. HTTP de erro, JSON inválido, timeout e cancelamento não o acionam.
  - Faz uma única tentativa extra com o mesmo prompt e a mesma imagem, `options.num_gpu: 0` e `keep_alive: 0`, para que o runner CPU não fique residente e capture as chamadas seguintes (achado do Adendo 1).
  - Tem orçamento por instância, `maxCpuFallbacks` / `NB_LOCAL_VLM_MAX_CPU_FALLBACKS` (padrão 10), e timeout próprio, `cpuFallbackTimeoutMs` / `NB_LOCAL_VLM_CPU_FALLBACK_TIMEOUT_MS` (padrão 180 s).
  - Se a CPU também degenerar, rejeita com o mesmo `code` depois de exatamente 2 chamadas. Com o orçamento esgotado, rejeita sem nova chamada.
- A rota padrão **não foi alterada**: não envia `num_gpu` nem `keep_alive`. `lastRoute()` (`'default' | 'cpu-fallback'`) foi exposto como extensão opcional, sem mudar a interface `VisualAnalysisProvider`.

Testes (TDD):
- `packages/orchestrator/test/ollama-degenerate-fallback.test.ts` (novo, 7 casos, usando o envelope real de 96 bytes). Falhou antes da implementação (export ausente) e passa 7/7 depois.
- `ollama-local-vlm-protocol.test.ts`: 6/6. `phase4a-provider-capabilities.test.ts`: 5/5. `packages/cinema/test/recap/phase4a-routing.test.ts` + `apps/aethera-remote-host/test/phase4a-capabilities.test.ts`: 5/5.
- **BLOCKED (ambiente):** `aethera-vision-capabilities.test.ts` importa `vitest`, que não está instalado no workspace. Isso independe do patch.
- `tsc --noEmit -p packages/orchestrator`: 0 erros em `vision-providers.ts` e no teste novo. Os 123 erros restantes estão em arquivos não tocados (`router.test.ts`, `spotify-adapter.test.ts`, etc.) e já existiam.

**Por que não foi commitado:** o provider Ollama inteiro (~347 linhas) e `ollama-local-vlm-protocol.test.ts` são alterações não commitadas/não rastreadas de outra sessão. Commitar o patch levaria esse trabalho junto, e o teste novo depende dele. Rollback: reverter os blocos marcados com `OLLAMA_RUNTIME_DEGENERATE_OUTPUT`, `requestChat`, `cpuFallback*` e `lastRoute`, e apagar o teste novo.

**Ainda não verificado ao vivo:** o fluxo real com `p0_0` (padrão → degenerado → CPU com `keep_alive:0` → próxima chamada recarregando na GPU). Validar exige 2 a 3 chamadas locais.

## Adendo 10 — validação ao vivo do P1 pelo adapter real (20:14:22–20:15:07)
Script `scratchpad/p4b4/live-p1.mts` (fora do repo) chamando `createOllamaLocalVlmProvider({ cpuFallbackOnDegenerateOutput: true, maxCpuFallbacks: 1 })`. As envs `NB_LOCAL_VLM_*` presentes (4096/1200/1) são iguais aos padrões. Modelo descarregado antes. **3 chamadas reais**, todas confirmadas no `server.log`:

| # | Chamada | Log | Resultado do transporte |
| --- | --- | --- | --- |
| 1 | A: `p0_0`, rota padrão | `offloaded 37/37`, `CLIP using CUDA0`, `@ (31)` exception, HTTP 200 em 3,35 s | `OLLAMA_RUNTIME_DEGENERATE_OUTPUT` → fallback |
| 2 | A: fallback CPU | `reason=cpu-only`, `CLIP using CPU backend`, HTTP 200 em 37,16 s | `done=true`, 1949/411 tokens, `lastRoute()='cpu-fallback'`; `ollama ps` logo depois: **nada carregado** (`keep_alive:0` funcionou) |
| 3 | B: sintética 128 px, rota padrão | runner novo, `offloaded 37/37`, `CLIP using CUDA0`, HTTP 200 em 4,92 s | `done=true`, 1254/253 tokens, `lastRoute()='default'`; `ollama ps`: **100% GPU**, VRAM 6064 MiB |

**P1: PASS.** O erro foi classificado, houve uma única tentativa em CPU, sem loop, o runner CPU não ficou residente e a chamada seguinte voltou para a GPU.

### Novo achado P1, fora do patch: a saída real do modelo não passa no schema do adapter
Nas duas análises, A (CPU) e B (GPU), `adaptLocalPanelAnalysis` → `localPanelAnalysisSchema.parse` rejeitou o JSON. Issues capturadas (lista parcial, porque a mensagem foi truncada em 600 caracteres):
- A: `schemaVersion` "expected 1" (veio `"1"` string), `natureConfidence` "expected number, received string", `frames[0].observed` "expected string, received boolean", entre outras.
- B: `schemaVersion` "expected 1", `nature` fora do enum, entre outras.

Isso bate com o que se viu nos Adendos 5 e 7: confianças como `"high"`, `"null"` como string, `characters` com entradas espúrias. **Hoje a rota local falharia na validação na maioria dos painéis, independentemente do dispositivo.** O erro também não é classificado (`code=null`), e vem como um array zod bruto. Não corrigi nada aqui, porque está fora do escopo do P1.

### Recomendação para retomar a Fase 4B (atualizada)
1. **Contrato de saída local (P1 novo):** declarar no prompt tipos e enums explícitos (números 0–1, `nature` do enum, `observed` string, `schemaVersion: 1` numérico) e/ou adicionar uma camada de normalização limitada antes do `parse` (`"1"`→1, `"high|medium|low"`→0.85/0.6/0.35, `"null"`→null). Classificar a rejeição como `RECAP_LOCAL_SCHEMA_INVALID` com a lista de paths, sem o array bruto. Validar com `p0_0` + 2 a 3 painéis reais, mais o caso sintético.
2. Só depois disso fazer o piloto de ~10 painéis na GPU, com `NB_LOCAL_VLM_CPU_FALLBACK=1` e orçamento baixo, medindo a taxa de degeneração, a taxa de schema válido e o tempo por painel.
3. Commitar o provider Ollama (trabalho da outra sessão) junto com o P1, depois que os donos revisarem.

## Adendo 11 — contrato de saída local (prompt + normalização limitada), aplicado e **não commitado**
Mudanças em `packages/orchestrator/src/aethera/vision-providers.ts`, no mesmo working tree não commitado da outra sessão:
- **Prompt:** a linha "Retorne somente JSON compacto com: …" virou um **esqueleto JSON tipado** com `schemaVersion:1` numérico, o enum completo de `nature`, `exatamente N item em frames`, `overlays` booleanos e confiança numérica, mais uma linha com os formatos de `dialogue`/`characters`/`actions`/`environment`, os enums de `region`/`basis` e "characters só pessoas/criaturas". As regras editoriais existentes ficaram intactas. Tamanho: 1213 caracteres sem contexto e **1988** com o contexto máximo de 800 (o teste existente exige menos de 2000; a folga é de só 12 caracteres). Custo medido: +121 tokens de texto por painel (238 → 359).
- **Normalização limitada** (`normalizeLocalPanelAnalysis`, antes do `safeParse`):
  - Sem perda: `"1"`→1, confiança numérica em string → número, `"null"/"none"/""`→null ou [], `limitations` string/objeto → lista, trim e truncamento nos limites do schema.
  - Com perda, sempre declarada numa nota `Saída local normalizada: …` em `limitations`: rótulos `very high/high/medium|moderate/low/very low` → 0.95/0.85/0.6/0.35/0.15; `nature` fora do enum → `other`; N frames com `observed` string para 1 imagem → 1 frame com as observações unidas; `observed` não-string em frame único → `description` do próprio modelo; `environment` sem `description` → null; `overlays` ausente/`[]`/`"null"` → ausentes.
  - O que não tem mapeamento determinístico (rótulos como "maybe", `observed` booleano com vários frames, texto vazio) **não é convertido** e falha.
- **Erro classificado:** `RECAP_LOCAL_SCHEMA_INVALID` (`LocalPanelSchemaError.code`), com até 8 `path: mensagem` em ≤600 caracteres, sem o array bruto do zod. A divergência de contagem de frames também usa esse código.

Testes (TDD): `packages/orchestrator/test/ollama-local-contract.test.ts` (novo, 6 casos com os formatos reais de `p0_0` em CPU e da grade sintética em GPU). Antes da implementação falhou por falta do export; depois passa 6/6. Suíte relacionada: **29/29** (contrato 6, fallback 7, protocolo 6, capacidades 5, roteamento Recap + Remote Host 5). `tsc`: 0 erros nos arquivos tocados (os 123 que já existiam continuam iguais). `git diff --check` limpo.

### Verificação ao vivo pelo adapter real (20:20:18–20:21:00, 3 chamadas)
| Chamada | Log | Resultado |
| --- | --- | --- |
| `p0_0`, rota padrão | `CLIP using CUDA0`, text=359/total=2070, `@ (31)` | degenerado → fallback |
| `p0_0`, fallback CPU | `reason=cpu-only`, `CLIP using CPU backend`, 32,25 s | **schema válido**, `landscape`, descrição coerente em PT-BR (noite, montanhas com névoa, árvores, céu estrelado, lua), `characters=[]`, `environment` preenchido, `limitations=[]`; runner descarregado depois |
| Grade sintética 980×1372, rota padrão | `CLIP using CUDA0`, 100% GPU, 4,89 s | **schema válido**, `characters=[]` (antes as formas viravam personagens) |

**Nenhuma das duas precisou de normalização** (sem nota em `limitations`): só o prompt já produziu o contrato. A normalização fica como rede de segurança testada.

### Riscos e limitações remanescentes
- **Confianças ancoradas no exemplo:** `natureConfidence` e `confidence` vieram exatamente 0.8 nos dois casos, o mesmo valor do esqueleto. Não use essas confianças locais como gate até haver calibração (por exemplo, remover o número do exemplo ou medir a dispersão num piloto).
- **Qualidade semântica na grade sintética:** `nature: landscape` e "four squares" para 6 painéis. Normalização não corrige isso; é uma limitação do modelo de 3B.
- Na descrição de `p0_0`, "lua no horizonte" está errado (ela está no alto). É uma imprecisão menor.
- A folga do prompt é de 12 caracteres em relação ao limite de 2000 do teste: qualquer acréscimo exige rever esse orçamento.

### Próximo passo da Fase 4B
Piloto de ~10 painéis reais deduplicados na GPU, com `NB_LOCAL_VLM_CPU_FALLBACK=1` e `NB_LOCAL_VLM_MAX_CPU_FALLBACKS` baixo, medindo a taxa de degeneração, a taxa de schema válido, a frequência das notas de normalização, a dispersão das confianças e o tempo por painel. Depois, commitar o provider Ollama junto com o P1 e o contrato, com a revisão dos donos.

## Adendo 12 — piloto com 10 painéis reais (20:22:40–20:23:45): FAIL no contrato, degeneração GPU em 1/10
Script `scratchpad/p4b4/pilot.mts` com o adapter real, `cpuFallbackOnDegenerateOutput: true`, `maxCpuFallbacks: 3`, prazo de 15 min, sem retries.
- Seleção: 437 painéis, todos únicos por sha256. `p0_0` foi excluído, porque é o caso conhecido. **4 painéis foram excluídos por não caberem no contexto**: `p24_1` (~3915 tokens de imagem), `p28_1` (~9106), `p58_12` (~3741) e `p71_0` (~2755). Restaram 432 elegíveis, e os 10 foram escolhidos em intervalo fixo ao longo do capítulo (p0_1 … p67_0, 800×293 a 800×827).
- Log: **11 chamadas** (10 painéis + 1 fallback), todas com HTTP 200, 3 inícios de runner (GPU → CPU → GPU). Houve 1 exceção `@ (31)`.

| Métrica | Valor |
| --- | --- |
| Degeneração na GPU | **1/10** (`p39_1`, 1404 tokens no total; não depende do tamanho, já que essa imagem é pequena) → fallback CPU de 29,1 s |
| Schema válido | **3/10** (`p19_1`, `p26_3`, `p47_3`) |
| `RECAP_LOCAL_SCHEMA_INVALID` | **7/10** |
| Tempo na GPU | 2,1–5,4 s por painel; o fallback CPU levou 29,8 s; wall total ~65 s |
| Tokens | 1404–1439 de entrada por painel (sempre ~1024+ de imagem por causa de `--image-min-tokens 1024`, mesmo com imagem de 319 tokens) e 171–451 de saída. Total ≈ 14,3 k de entrada e 3,2 k de saída. Custo 0 (local) |
| VRAM | ≤ ~6,2 GB |

### Causas das 7 falhas (todas no prompt v2 do Adendo 11)
1. **`characters[].evidence` ausente em 7/7.** Ao compactar o prompt, o exemplo de `characters` saiu do esqueleto e ficou só a lista `{name,basis,evidence,confidence}`. O modelo omite `evidence`. A normalização **não** preenche esse campo, porque seria inventar.
2. **`dialogue[].region` fora do enum** (1 painel, 2 falas). O valor exato não foi capturado, porque o piloto não grava a saída bruta.
3. **`nature` copiado literalmente do enum** (`"action|exploration|landscape|…"`) em `p19_1`. A normalização mapeou para `other` e registrou a nota. É um efeito do prompt.
4. **Confiança ancorada:** nas 3 válidas, `natureConfidence` e `confidence` vieram 0.8, o mesmo valor do exemplo do esqueleto.
5. Nas 3 válidas, `entities=0`, `actions=0` e `environment=null`. É pouca informação, coerente com o modelo copiando os `[]`/`null` do esqueleto.

### Conclusão
- O P1 (classificação + fallback) se comportou como projetado em uso real.
- **O prompt v2 não está pronto.** O caso sintético e o `p0_0` passaram, mas os painéis com personagens e diálogo falham, e o esqueleto ancora valores (`[]`, `null`, `0.8`, a string do enum).
- **Não processar os 437 painéis** com a rota local neste estado.

### Correção proposta (prompt v3), a validar com os mesmos 10 painéis (≤13 chamadas)
- Esqueleto sem valores que o modelo copie: `nature` como um único valor válido, com o enum listado separadamente; confiança sem número fixo (descrita como "número 0–1 que você estimar"); e um item de exemplo em `characters`, `actions` e `dialogue` mostrando **todos** os campos, incluindo `evidence`.
- Para caber no limite de 2000 caracteres do teste, tirar texto redundante da linha de formatos. A alternativa é Ollama structured outputs (`format` = JSON schema, que restringe tipos e enums na geração), mas isso muda o contrato `format:'json'` do teste da outra sessão e precisa de aprovação.
- O piloto deve gravar a saída bruta de cada painel (local, limitada) para diagnosticar valores fora do enum.

## Adendo 13 — piloto v3 com os mesmos 10 painéis + verificação visual de cada painel
Mesmo script e mesmos painéis do Adendo 12, agora com o prompt v3 (esqueleto sem valores copiáveis, item de exemplo completo em `characters`/`actions`/`dialogue`) e a proteção contra placeholder. Desta vez a saída bruta foi gravada (`scratchpad/p4b4/run13-pilot-v3/raw-responses.json`, local). O v2 não tinha captura bruta: dos painéis inválidos do v2, só há a mensagem de erro. Nenhum código foi alterado depois do piloto, e nenhum outro piloto foi executado.

### Métricas v2 × v3
| Métrica | v2 (Adendo 12) | v3 |
| --- | --- | --- |
| Chamadas ao modelo | 11 | 11 |
| Degeneração na GPU → fallback CPU | 1/10 (`p39_1`), CPU 29,8 s | 1/10 (de novo `p39_1`), CPU 27,0 s. A falha é determinística por conteúdo |
| Schema válido | 3/10 | 4/10 (`p10_1`, `p19_1`, `p47_3`, `p55_8`) |
| Válidos com conteúdo real | **0/3**: os 3 tinham `description: "..."` (placeholder ecoado; a proteção do v3 os reprovaria) | 4/4 sem placeholder |
| Válidos **e fiéis à imagem** | 0 | **1/4** (`p55_8`) |
| Campo ausente dominante | `characters[].evidence` (7/10) | `characters[].confidence` (6/10) |
| Outros desvios | `region` fora do enum (1); `nature` = string do enum inteiro (1) | `region: null` (1, `p31_7`); `environment` em formato livre (3: objeto, string, objeto aninhado) |
| Normalizações aplicadas | `nature` → `other` (`p19_1`) | `frames 2→1` (`p55_8`) |
| Tokens de entrada / saída por painel | 1404–1439 (média 1420) / 171–451 (média 305) | 1410–1445 (média 1426) / 228–326 (média 274) |
| Tempo na GPU (9 painéis) | 2,2–5,4 s, média 3,9 s | 2,8–5,3 s, média 3,6 s |
| Wall total | ~64,6 s | ~59,5 s |
| VRAM após cada chamada na GPU | ≤ ~6,2 GB | 6,1–6,2 GB (CPU: 2,2 GB, com o runner descarregado) |

### Confiança e evidência no v3
- `natureConfidence` = 0.9 em 10/10; `confidence` = 0.8 ou 0.9 em 10/10; confiança de ação = 0.8 em 10/10; confiança de personagem, quando presente, = 0.9.
- Não há relação entre confiança e acerto: `p10_1` tem personagem com 0.9 e diálogo inventado. **As confianças locais não servem como gate.**
- `evidence` veio em 10/10 dos painéis com personagens (no v2, faltava em 7/10). Mas muitas vezes é tautológica ou é a própria inferência: "The character responding with 'Prince?!' is likely the Prince" (`p59_0`) e "The speech bubble contains the dialogue" (`p26_3`).

### Verificação visual por painel (v3; v2 quando havia conteúdo)
| # | Painel | O que a imagem mostra | Saída v3 | Schema | Fidelidade | Erros / invenções |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `p0_1` | Figura descalça, de roupa branca e faixa roxa, correndo numa floresta escura | "Person running through the forest" | FAIL (`confidence`) | Alta | "kimono" é aproximado |
| 2 | `p10_1` | Personagem ferido e ensanguentado, em choque; SFX coreano 푸욱 (perfuração) embaixo, à direita | "dark hair, white shirt, speaking"; diálogo "フー" (top) | **PASS** | **Baixa** | Diálogo **inventado** (o SFX coreano virou fala japonesa, na região errada); "speaking" inventado; ferimento e sangue omitidos |
| 3 | `p19_1` | Close de um olho semicerrado, pupila rosa, cabelo cinza | Descrição do olho ok; `nature: action`; ação "cena de ação ou exploração" | **PASS** | Média-baixa | `nature` e ação **inventadas**. O v2 inventou "olho arregalado, surpresa" e trazia `description: "..."` |
| 4 | `p26_3` | Só um balão de texto, sem personagem | OCR correto; personagem "Unknown character" | FAIL (`confidence`) | Média | Personagem **inventado** |
| 5 | `p31_7` | Homem de pé, de coque, inclinado sobre o jovem deitado (o Príncipe) | OCR dos 2 balões correto; "Prince" = o homem de pé | FAIL (`region` null) | Média-baixa | **Identidade invertida** |
| 6 | `p39_1` (CPU) | Jovem de cabelo longo e roupa tradicional (o Príncipe), machucado; a mão de alguém fora do quadro estende-se até ele; SFX 척 | Descrição e OCR corretos; ação "Character 1 agradece **e** pede desculpas" | FAIL (`confidence`) | Média | As 2 falas são de falantes diferentes ("I'M SORRY, PRINCE!" é dito **ao** Príncipe); SFX omitido |
| 7 | `p47_3` | Close extremo dos olhos, cabelo roxo, suor, choque; SFX 헉 | "dark hair, **plaid shirt**, speaking"; OCR "IF A POINT THAT CAN IMMobilIZE IS POKED AT…" | **PASS** | **Baixa** | Camisa xadrez **inventada** (só há olhos e cabelo); OCR truncado (falta "THE BODY OF THE PERSON WILL BE IMMOBILIZED WHICH CAN…") e com caixa corrompida; choque omitido |
| 8 | `p55_8` | Vista de cima de um homem de rabo de cavalo e roupa branca, apoiado no parapeito de uma janela treliçada aberta, em prédio tradicional; 2 caixas de narração do sistema | "standing by a window, looking out"; as 2 caixas transcritas sem erro | **PASS** (normalizado, `frames 2→1`) | Alta | Caixas de narração classificadas como diálogo; `environment` null, apesar do cenário claro |
| 9 | `p59_0` | Close de homem musculoso, de barba rala e roupa vinho, em choque; SFX 흠칫; balões "AAHH...!" e "PRINCE?!" | OCR correto; "Prince" = quem diz "Prince?!" | FAIL (`confidence`) | Média-baixa | **Identidade invertida**: quem chama "Prince?!" não é o Príncipe; SFX omitido |
| 10 | `p67_0` | Pessoa de branco comendo às pressas com hashi (SFX 우걱 ×2); homem de coque e colete escuro, de pé à direita, de costas | Descrição e OCR corretos; "Character 2 aconselha a comer devagar" | FAIL (`confidence`, `environment`) | Alta | "atrás" é impreciso (ele está ao lado, à direita); SFX omitido |

### Padrões de erro (v3)
- **OCR de balões em inglês:** 8 de 9 painéis com texto em inglês foram transcritos corretamente. A exceção é `p47_3`, truncado e com caixa corrompida.
- **SFX coreano:** 0 de 7 foram transcritos. Em 6, o SFX foi omitido, o que é aceitável. Em 1 (`p10_1`), virou diálogo japonês inventado, o que é grave.
- **Identidade e atribuição de falas:** houve erro em 3 dos 4 painéis com o nome "Prince" ou com 2 falantes (`p31_7`, `p39_1`, `p59_0`). O modelo dá o nome citado no balão a quem está visível. Num recap, isso troca os personagens da narrativa.
- **Atributos inventados:** 4 painéis (`p10_1` fala, `p19_1` ação, `p26_3` personagem, `p47_3` roupa).
- **Ações:** genéricas ("Speaking") ou inferidas do texto. A ação física visível (correr, comer, inclinar-se) só aparece quando é óbvia.
- **Posições:** `region` está correto quando vem preenchido. A posição relativa dos personagens é imprecisa (`p67_0`), e não há campo para ela.

### Conclusão
- **FAIL para produção.** No v3, 4/10 passam no schema, mas só 1/10 passa no schema **e** é fiel à imagem. Os outros 3 aprovados trazem fala, ação ou roupa inventadas, com confiança de 0.8 a 0.9. Aprovar pelo schema alimentaria o roteiro com alucinações.
- O v3 consertou o que o prompt controla (`evidence`, enum copiado, placeholder) e trocou o defeito: agora falta `confidence`. Com 1983 de 2000 caracteres, refinar o prompt vira trocar um campo por outro.
- A falha CUDA em `p39_1` continua determinística (2 de 2 pilotos). O fallback CPU funcionou nas duas vezes.
- **Não processar os 437 painéis.**

### Opções para a decisão do usuário (nada foi executado)
1. **Continuar refinando o prompt do Qwen.** Não é recomendado como caminho principal: o orçamento de prompt acabou, e os erros de fidelidade (identidade, invenção) não são de formato.
2. **Structured outputs do Ollama** (`format` = JSON schema). Deve eliminar as falhas de forma: os 6 casos de `confidence` ausente, `region` null e `environment` livre. **Não corrige a fidelidade.** Riscos: muda o contrato `format:'json'` testado pela outra sessão; e a falha CUDA ocorre justamente no sampler de grammar ("empty grammar stack"), então `p39_1` e `p0_0` precisam entrar no teste.
3. **Separar visão, OCR e normalização.** É o que ataca a fidelidade:
   - (a) uma etapa visual restrita ao que é observável (quem aparece, aparência, ação física, posição), sem nomes e sem atribuição de falas;
   - (b) uma etapa de OCR para balões e caixas, com os SFX marcados como "sfx não transcrito" em vez de traduzidos;
   - (c) normalização determinística em código, como hoje;
   - (d) identidade ("quem é o Príncipe") e atribuição de falas resolvidas na etapa narrativa, com contexto de vários painéis, e não por painel.
- **Recomendação técnica:** 2 + 3 juntos. Structured outputs para a forma, com um piloto barato nos mesmos 10 painéis que inclua os casos CUDA. Separação de responsabilidades para a fidelidade, com um esquema por painel sem nomes, sem atribuição e sem usar a confiança autodeclarada como gate. O critério de aceite do próximo piloto deve ser a **fidelidade verificada por painel**, não a taxa de schema.

## Adendo 14 — avaliação do `qwen3.5:4b-q4_K_M` como substituto (20:36–20:39)
Pedido do usuário: avaliar o Qwen3.5 4B sem substituir o modelo padrão. O download desse único modelo foi autorizado. Não processei os 437 painéis, não rodei TTS e não renderizei nada.

### Compatibilidade
- Pela página da biblioteca do Ollama, a família Qwen 3.5 é multimodal ("Text, Image") e a tag `4b-q4_K_M` tem 3,3 GB.
- `ollama show` depois do pull: arquitetura `qwen35`, 4,2B parâmetros, `requires 0.30.0` (o ambiente tem a 0.40.16), capacidades `completion, vision, tools, thinking`, projetor CLIP de 333M e **thinking ligado por padrão**. Os padrões do Modelfile são `temperature 1`, `top_k 20`, `top_p 0.95` e `presence_penalty 1.5`.
- O `qwen2.5vl:3b` continua instalado. O código, as variáveis `NB_LOCAL_VLM_*` e o modelo padrão (`qwen2.5vl:3b`) não foram alterados.
- **Bloqueios para adoção (código, não aplicados):**
  1. O provider não envia `think`. Com o padrão, o thinking consome os 1200 tokens de `num_predict` e a resposta volta vazia.
  2. `isKnownVisionModel` (regex `…vl`) não reconhece `qwen3.5`, então `detect()` desabilita a rota local, mesmo com `vision` confirmado em `/api/show`.
  3. O erro HTTP 500 "token repeat limit reached" não é classificado.
- Os testes chamaram `analyze()` direto e injetaram `think:false` só no `fetch` do script (`scratchpad/p4b4/p0_0-qwen35.mts` e `pilot-qwen35.mts`).

### `p0_0` direto na GPU, sem fallback
| Execução | Resultado |
| --- | --- |
| Provider como está (thinking padrão) | 48,1 s, `done_reason: length`, 1200 tokens de saída, 4967 caracteres em `message.thinking` e `content` vazio. O adapter acusou "done=true sem conteúdo" |
| `think:false` | **OK em 4,6 s, 100% GPU.** Sem o token `@` e sem degeneração. 1615 tokens de entrada e 133 de saída. VRAM de 5,5 GB |

- A descrição do `p0_0` com `think:false` está correta: noite, lua alta, montanhas escarpadas com névoa, árvores em silhueta. Não inventou personagem (`characters: []`). O `qwen2.5vl` tinha inventado "Unknown" e posto a lua "no horizonte".
- `environment` veio como string e foi descartado pela normalização.

### Piloto com os mesmos 10 painéis
- Execução: `run15-qwen35-pilot`, `cpuFallbackOnDegenerateOutput: false`, 10 chamadas, nenhum retry, todas na GPU.
- A base de comparação é o piloto v3 do `qwen2.5vl:3b` (Adendo 13): mesmo prompt, mesmo código, mesmos painéis.

| Métrica | qwen2.5vl:3b (v3) | qwen3.5:4b-q4_K_M |
| --- | --- | --- |
| Falha de runtime na GPU | 1/10 (`p39_1`, `@`/envelope vazio) → CPU 27 s | 1/10 (`p10_1`, HTTP 500 "token repeat limit reached", após 6,5 s); `p39_1` e `p0_0` **passam** na GPU |
| Schema válido | 4/10 | **8/10** |
| Inválidos por quê | `characters[].confidence` ausente (6), `region` null (1) | `region` fora do enum (1: SFX com `center-left`/`bottom-right`) |
| Normalizações | 1 (`frames 2→1`) | 6 painéis: `nature` com 2 valores → `other` (2), `frames 2→1` (2), `environment` em texto livre descartado (4), item com `name:""` removido (1) |
| Válidos **e fiéis** (sem fala, personagem, identidade ou roupa inventados) | **1/10** | **5/10** (`p0_1`, `p19_1`, `p26_3`, `p39_1`, `p67_0`); com ressalvas, outros 2 (`p31_7`, `p55_8`) |
| Identidade invertida ("Prince") | 3 | **0** |
| Personagem inventado | 1 (`p26_3`) | **0** |
| Fala inventada | 1 (`p10_1` "フー") | 1 (`p47_3` "劍!" para o SFX 헉) |
| Roupa ou atributo inventado | 1 (camisa xadrez) | 0 inventados; 2 imprecisos ("light blue eyes", "olho wide") |
| OCR de balões em inglês | 8/9 corretos; `p47_3` truncado | 8/8 completos entre as respostas; 1 palavra errada ("SCAN TIME" ≠ "SCANNING TIME"); 1 fala duplicada (`p31_7`) |
| SFX coreano | 6 omitidos, 1 virou fala japonesa | 3 lidos aproximadamente (음칫≈흠칫, 우각≈우걱) **como diálogo**, 1 virou "劍!", resto omitido |
| Tokens de entrada / painel | 1410–1445 (média 1426; mínimo de 1024 por imagem) | **566–991 (média 766)**, proporcional ao tamanho |
| Tokens de saída / painel | 228–326 (média 274) | 157–421 (média 325) |
| Latência na GPU | média 3,6 s | média 4,9 s |
| Wall total | 59,5 s (com 27 s de CPU) | 50,8 s |
| VRAM após cada chamada | 6,1–6,2 GB | **5,5–5,7 GB** |

### Confiança
O esqueleto do v3 traz `0.0`, e o `qwen3.5` **não copiou** esse valor. As confianças variam de 0.6 a 1.0, mas continuam autodeclaradas e altas, sem relação com o acerto:
- 0.97 numa "ação" deduzida só do texto da caixa (`p55_8`);
- 0.95 para um personagem com olhos "light blue" (são claros/brancos) em `p59_0`;
- 1.0 em `p26_3`.

**Não usar confiança como evidência ou gate**, em nenhum dos dois modelos.

### Verificação visual por painel (qwen3.5)
| # | Painel | Saída | Fidelidade | Erros / invenções |
| --- | --- | --- | --- | --- |
| 1 | `p0_1` | Personagem de roupa branca com detalhes roxos, correndo entre árvores escuras | Alta | A normalização **removeu o personagem** porque `name` veio `""`, e restou só a ação; `nature` com 2 valores |
| 2 | `p10_1` | HTTP 500, repetição abortada | — | Sem análise |
| 3 | `p19_1` | `portrait`; olho em close, cabelo cinza, íris violeta, traços de tensão | Média-alta | "eye appears wide": o olho está semicerrado. Sem ação inventada (o qwen2.5 dizia "action") |
| 4 | `p26_3` | Só o balão; OCR exato; `characters: []` | Alta | Nenhum |
| 5 | `p31_7` | Um de pé gritando sobre outro deitado e ferido; 2 falas | Média-alta | Papéis **corretos** (sem inverter o Príncipe); OCR juntou as 2 falas na 1ª e repetiu a 2ª (fala duplicada); "tendendo" no lugar de "deitado"; SFX 후다닥 omitido |
| 6 | `p39_1` | Jovem de roupa tradicional, surpreso; "mão de alguém fora do quadro"; 2 falas | Alta | Nenhum relevante. Não atribuiu as 2 falas à mesma pessoa. Rodou na GPU |
| 7 | `p47_3` | Close com suor e choque; OCR completo | Média | SFX 헉 virou **"劍!" como fala**; caixa corrompida ("IMMobilize") |
| 8 | `p55_8` | Personagem de branco numa janela aberta de prédio tradicional, luzes ciano; 2 caixas | Média | "pendurado" (está apoiado); "SCAN TIME" (é "SCANNING TIME"); `nature: interface` discutível; ação deduzida do texto |
| 9 | `p59_0` | Close masculino, barba rala, choque, fundo de velocidade; 3 textos | Alta no visual, mas o schema falhou | SFX como fala com região fora do enum; "light blue eyes"; **sem** inversão de identidade |
| 10 | `p67_0` | Um sentado comendo, outro de pé; fala correta | Média-alta | A descrição diz "duas pessoas sentadas", contradizendo os personagens; "pinças" (são hashi); SFX como fala |

### Conclusão
- **O `qwen3.5:4b-q4_K_M` é melhor que o `qwen2.5vl:3b` em quase tudo que importa para o Recap.**
  - Fidelidade: 5/10 contra 1/10 válidos e fiéis.
  - Nenhuma inversão de identidade, contra 3.
  - Nenhum personagem inventado.
  - `p0_0` e `p39_1` rodam na GPU, sem o fallback CPU de ~30 s.
  - 46% menos tokens de entrada.
  - ~0,5 GB menos de VRAM.
- Custo: +1,3 s por painel na GPU.
- **Ainda não está pronto para produção:**
  1. Precisa de `think:false` no provider (sem isso, 0% de sucesso).
  2. Precisa liberar o `detect()` para `qwen3.5` (usando a capacidade `vision` do `/api/show` em vez da regex).
  3. Precisa classificar o "token repeat limit" como falha de runtime recuperável ou `needs_review`.
  4. Os SFX coreanos ainda viram diálogo, e "劍!" foi uma invenção. Precisam de tratamento (classe `sfx` ou filtro de texto só em Hangul).
  5. A normalização descarta `environment` em texto e personagens com `name:""`. Structured outputs ou um mapeamento explícito resolveriam.
  6. `temperature 1` (padrão do Modelfile) deixa a saída não determinística. A variância não foi medida (1 execução por painel).
- **Amostra pequena:** 10 painéis, 1 execução cada. A vantagem é grande e consistente nos erros graves, mas não é estatisticamente fechada.
- **Recomendação:** adotar o `qwen3.5:4b-q4_K_M` como **candidato** a modelo do Recap e manter o `qwen2.5vl:3b` instalado como reserva, **sem trocar o padrão ainda**. Próximos passos:
  1. Aplicar os itens 1–3, com testes.
  2. Rodar um piloto de confirmação (os mesmos 10 painéis + `p0_0` + os 4 que excedem o contexto, com `temperature` baixa e 2 execuções para medir a variância), avaliado por fidelidade de cada painel.
  3. Só então trocar `NB_LOCAL_VLM_MODEL`.
- A separação recomendada no Adendo 13 continua válida: SFX e identidade de personagens na etapa narrativa, com contexto de vários painéis.

## Adendo 15 — ajustes de adoção no provider (modo `fix`) + piloto de confirmação (20:44–20:46)

### Ajustes aplicados em `vision-providers.ts` (**não commitados**)
O arquivo continua misturado com o provider Ollama da outra sessão. Os testes novos dependem desse código, por isso também ficam fora do commit.
1. **`think`:** o provider passa a enviar `think` sempre; o padrão é `false`. Só a opção `think: true` ou `NB_LOCAL_VLM_THINK=1` liga o thinking. Validado ao vivo: o `qwen2.5vl:3b` aceita `think:false` sem mudar nada e recusa `think:true` ("does not support thinking").
   - Se uma resposta vier só com thinking (`content` vazio), o erro diz isso: `thinkingChars=…, done_reason=…; use think=false`. Antes era um "sem conteúdo" genérico.
2. **`detect()`:** a regex `isKnownVisionModel` foi removida. A multimodalidade agora é comprovada só pela capacidade `vision` em `/api/show`, que já era obrigatória. A mensagem de recusa passou a dizer "modelo não multimodal/visual".
3. **Repetição abortada:** `OLLAMA_RUNTIME_REPETITION_ABORTED` / `OllamaRepetitionAbortedError` cobrem o HTTP 500 "token repeat limit reached" e também o mesmo erro no corpo de uma resposta 200 ou NDJSON. Nesse caso não há fallback CPU nem retry, e a mensagem diz que o painel precisa de revisão.
4. **Opção `temperature`** (`NB_LOCAL_VLM_TEMPERATURE`): sem valor, mantém o padrão do Modelfile; também vale no fallback CPU.

**O modelo padrão continua `qwen2.5vl:3b`.**

**Testes:**
- `test/ollama-qwen35-adoption.test.ts`, novo, com 7 testes: o arquivo falhou antes da implementação (export ausente) e passa depois.
- Suítes Ollama e de capacidades (`ollama-qwen35-adoption`, `ollama-local-contract`, `ollama-degenerate-fallback`, `ollama-local-vlm-protocol`, `phase4a-provider-capabilities`): **33/33**.
- `aethera-vision-capabilities.test.ts` usa vitest, que não está instalado no workspace. Não foi executado, mas os casos de `detect` dele foram lidos e não dependem da regex.
- `tsc`: 123 erros que já existiam; nenhum nos arquivos tocados.

### Piloto de confirmação
- Script `scratchpad/p4b4/pilot-confirm.mts`, saída em `run16-qwen35-confirm`.
- Provider já ajustado (o `think:false` vem do próprio provider, sem injeção no script), `temperature 0.2`, sem fallback CPU, sem retries.
- **15 painéis × 2 execuções = 30 chamadas:** os 10 do piloto, o `p0_0` e os 4 que excediam o contexto do `qwen2.5vl` (`p24_1`, `p28_1`, `p58_12`, `p71_0`).
- Todas as chamadas rodaram 100% na GPU, com wall total de 151 s.

| Grupo | Chamadas | Schema válido | Entrada (média) | Saída (média) | Latência (média) | VRAM |
| --- | --- | --- | --- | --- | --- | --- |
| `p0_0` | 2 | **2/2** | 1615 | 148 | 3,7 s | 5,6–5,7 GB |
| Os 10 do piloto | 20 | 12/20 | 566–991 (770) | 69–466 (341) | 4,8 s | 5,6–5,8 GB |
| Painéis grandes | 8 | 4/8 | 2416–3291 (2950) | 391–571 (482) | 7,6 s | 5,6–5,8 GB |
| **Total** | 30 | **18/30** | | | | ≤ 5,8 GB |

### Falhas
- **Schema (10), todas de forma:**
  - `confidence`/`natureConfidence` ausente: 5;
  - `region` fora do enum (`left-center`, `bottom-right`, `right`), sempre em SFX ou balões laterais: 4;
  - `frames` com 11 itens no `p26_3`, nas 2 execuções;
  - `frames[1]` como string ou null: 2.
  - O conteúdo dessas respostas era, na maioria, fiel. Structured outputs eliminariam esse tipo de falha.
- **Contexto:** `p28_1` pediu 4369 tokens com `num_ctx` 4096. O Ollama devolveu HTTP 400 explícito, sem falha silenciosa. A estimativa do provider (2048 por imagem) não previu isso. O caso precisaria de `num_ctx` maior ou de recorte do painel.
- **Repetição abortada:** 1 (`p47_3`, execução 2), classificada corretamente como `OLLAMA_RUNTIME_REPETITION_ABORTED`. Somando o piloto anterior (`p10_1`), são 2 em 40 chamadas.
- **Degeneração CUDA (`@`):** 0 em 30.

### Variância
- **Com `temperature 0.2`, o resultado não ficou estável:** em 8 dos 15 painéis, o status do schema mudou entre as execuções (`p0_1`, `p10_1`, `p19_1`, `p31_7`, `p47_3`, `p58_12`, `p59_0`, `p71_0`).
- Nos 10 painéis originais, o schema válido foi 5/10 na execução 1 e 7/10 na execução 2. No piloto anterior, com `temperature 1`, tinha sido 8/10.
- **Baixar a temperatura não melhorou o schema.**

### Confiança
- `natureConfidence` = 0.95 em 16 de 18 respostas válidas; `confidence` entre 0.90 e 0.95.
- Com temperatura baixa, os valores ficaram ancorados de novo e não distinguem respostas certas de erradas. **Não usar como evidência.**

### Fidelidade (verificação visual de cada resposta com conteúdo, 28 de 30)
| Painel | Execução 1 | Execução 2 |
| --- | --- | --- |
| `p0_0` | Fiel | Fiel |
| `p0_1` | Fiel (schema FAIL) | Fiel |
| `p10_1` | Fiel no visual (ferido, ensanguentado, choque); **SFX lido como "폭음" e posto como fala** (o real é 푸욱) | Igual (schema FAIL) |
| `p19_1` | Fiel (íris violeta, cabelo cinza, suor; schema FAIL) | "wide-eyed" e "dark hair" errados (o olho está semicerrado e o cabelo é cinza) |
| `p24_1` | OCR das caixas correto; poses de luta e de meditação corretas; descrição com "Moomin" (é "Moorim") | Fiel |
| `p26_3` | Fiel (sem personagem; schema FAIL) | Fiel (schema FAIL) |
| `p28_1` | Contexto excedido | Contexto excedido |
| `p31_7` | Fiel, falas separadas (schema FAIL) | Fiel |
| `p39_1` | Fiel; deduziu corretamente que o personagem visível é o "Prince" | Fiel |
| `p47_3` | OCR completo e correto; meta-texto "(Partial text visible…)" posto como fala | Repetição abortada |
| `p55_8` | Fiel; OCR exato ("SCANNING") | Fiel |
| `p58_12` | **Identidade invertida:** a mulher acamada recebeu o nome "Guard Jang", a quem ela se dirige; OCR só do 1º balão, omitindo 3 caixas; o homem de pé foi omitido | Fiel: mulher = Lady Hwa, homem de costas = Guard Jang; OCR das 5 falas correto (schema FAIL) |
| `p59_0` | Fiel; SFX "음칫" como fala (schema FAIL) | Fiel |
| `p67_0` | Fiel ("garfo" em vez de hashi) | Fiel |
| `p71_0` | **Identidade invertida** (a criança vira "Guard Jang"); "personagem feminina" (é um menino) | **Identidade invertida**; "deitado na cama" (está debruçado) |

### Resumo
- **Conteúdo sem erro grave:** 23/28 respostas. Os 5 erros graves são 2 SFX inventados como fala (`p10_1`) e 3 inversões de identidade por vocativo ("Guard Jang").
- **Válidos e fiéis:** 13/30; com ressalvas menores, 15/30. Nos 10 painéis originais, 9/20, o que confirma ~50% do piloto anterior.
- **Inversão de identidade:** não sumiu. Ela acontece com **vocativos** ("GUARD JANG, …" → o personagem visível vira Guard Jang). Com "Prince", o modelo acertou nas 4 respostas, mas o mecanismo de erro é o mesmo do `qwen2.5vl`.
- **Ganho do `qwen3.5` confirmado:**
  - sem degeneração CUDA;
  - 3 dos 4 painéis grandes que o `qwen2.5vl` nem conseguia tentar foram analisados com OCR longo correto;
  - menos tokens e menos VRAM.

### Recomendação atualizada
1. **Modelo:** `qwen3.5:4b-q4_K_M`, com os ajustes deste adendo, é a melhor opção local medida. Mesmo assim, **não deve virar padrão para os 437 painéis ainda**: o schema válido é de 50–80% por execução, com alta variância, e as inversões de identidade por vocativo continuam.
2. **Próximo passo de maior retorno: structured outputs** (`format` = JSON schema com enums de `region`/`nature`, `confidence` obrigatório, `maxItems` em `frames`). Isso ataca as 10 falhas de forma, cujo conteúdo era em sua maioria fiel; o potencial é subir de ~60% para ~80% de respostas válidas e fiéis. Precisa de aprovação, porque muda o contrato `format:'json'` testado pela outra sessão.
3. **Identidade:** tirar os nomes do esquema por painel (apenas `visualLabel`) e resolver vocativos e nomes na etapa narrativa. Nenhum dos dois modelos é confiável para isso por painel.
4. **SFX:** tratar Hangul isolado como `sfx`, nunca como diálogo.
5. **Contexto:** para painéis acima de ~3500 tokens de imagem (como o `p28_1`), aumentar `num_ctx` ou recortar o painel.
