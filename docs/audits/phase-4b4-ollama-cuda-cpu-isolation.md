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
