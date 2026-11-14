# Avaliação do ACE-Step 1.5 para o Aethera Studio

**Data:** 2026-11-12  
**Escopo:** pesquisa técnica e de licenças; nenhuma implementação foi feita.  
**Hardware-alvo:** RTX 4060 Ti com 8 GB de VRAM.  
**Política do Aethera:** operação local, sem serviços pagos, sem créditos externos, sem novas alterações no Rights Manager e sem commit/push.

## Conclusão executiva

**Integração local viável, condicionada a uma validação prática de memória e latência.** O ACE-Step 1.5 fornece um servidor REST local oficial (`acestep-api`) e uma API montada no Gradio. A integração pode ser feita pelo processo Node/Desktop do Aethera chamando `http://127.0.0.1:8001`, sem enviar roteiro, áudio ou resultados para um serviço remoto durante a geração.

Para a RTX 4060 Ti de 8 GB, a configuração inicial recomendada é:

```text
DiT: acestep-v15-turbo
LM: acestep-5Hz-lm-0.6B
backend do LM: pt (PyTorch)
quantização: INT8
offload: CPU + DiT, conforme detecção automática
batch: 1
```

O guia oficial de compatibilidade classifica 6–8 GB como Turbo + LM 0.6B com backend `pt`; a tabela detalhada também limita essa faixa a até 8 minutos com LM e batch máximo 2. O `gpu_config.py` da mesma revisão ainda deixa `vllm` como valor padrão na estrutura interna de Tier 3, mas o guia restringe a UI a `pt`/`mlx` nessa faixa por causa do KV cache. Para o Aethera, `pt` é a escolha conservadora e coerente com a documentação de 6–8 GB. A configuração 1.7B aparece para faixas superiores, portanto não deve ser o padrão em uma placa nominal de 8 GB. A capacidade real pode ser inferior a 8 GB após reservas do driver; se a detecção cair na faixa abaixo de 6 GB, deve-se desabilitar o LM e usar DiT-only.

Não recomendo implementar ainda um modo de geração que trate automaticamente os áudios como liberados para publicação comercial. O model card afirma que o áudio gerado pode ser usado comercialmente, mas isso é uma declaração do projeto/model card, não uma licença individual do arquivo nem uma garantia sobre direitos autorais em qualquer jurisdição. O Aethera deve continuar exigindo registro de origem, parâmetros, hash e evidência de licença; a decisão atual do canal continua não comercial.

## O que a API local oferece

O servidor oficial é FastAPI e mantém uma fila/job store em memória; o próprio código recomenda um único worker. A superfície relevante é:

| Endpoint | Uso no Aethera |
|---|---|
| `GET /health` | Verificar processo, versão e disponibilidade antes da geração |
| `GET /v1/models` | Confirmar o DiT carregado e impedir uso de um modelo inesperado |
| `POST /release_task` | Enfileirar geração assíncrona |
| `POST /query_result` | Consultar estado e resultado pelo `task_id` |
| `GET /v1/audio?path=...` | Recuperar arquivo de resultado, limitado pelo servidor ao diretório de resultados |
| `POST /format_input` | Opcional; enriquecer caption/lyrics com o LM |
| `POST /create_random_sample` | Não necessário para o fluxo determinístico do Aethera |

O contrato `/release_task` aceita, entre outros, `prompt`, `lyrics`, `thinking`, `sample_mode`, `model`, `bpm`, `key_scale`, `time_signature`, `audio_duration`, `inference_steps`, `guidance_scale`, `seed`, `batch_size` e `task_type`. Para trilhas instrumentais originais, o fluxo deve enviar `lyrics` vazio e `thinking: true` somente se o LM 0.6B estiver habilitado; caso contrário, usar o caminho DiT-only suportado pelo projeto. `task_type` deve ser `text2music`; não usar cover, continuation ou repaint sem uma evidência de direito sobre o áudio de referência.

O resultado de consulta inclui caminho de áudio e metadados como BPM, duração e tonalidade. A resposta pode ser JSON serializado dentro de `result`; o adaptador do Aethera deve tratar esse campo como dado não confiável, validar schema e confirmar que o caminho resolvido está dentro do diretório de resultados antes de copiar/importar.

### Integração proposta com o MotionVelix

O ACE-Step não precisa conhecer a timeline. O Aethera deve ser o orquestrador:

1. Transformar o roteiro e os marcadores de cena em um prompt instrumental por segmento, com gênero, emoção, intensidade, instrumentos, BPM aproximado e duração.
2. Normalizar esse pedido e calcular uma chave de cache baseada em modelo/revisão, prompt, seed, duração, BPM, parâmetros de inferência e modo instrumental.
3. Consultar o cache local por essa chave antes de gerar.
4. Se não houver hit, chamar `/release_task`, acompanhar `/query_result`, baixar o resultado local e calcular SHA-256.
5. Registrar a faixa como um asset de áudio com metadados de geração e associá-la a uma faixa `music` da timeline; o render existente já prevê ducking por palavras e mistura com SFX.
6. Aplicar `loudnorm`/limite de true peak no render final e registrar as medições reais do arquivo final no Quality Director.

Uma trilha por vídeo inteiro é o caminho mais simples. Para adaptação por cena, o Aethera pode gerar blocos por capítulo e fazer crossfade no render, mas deve evitar gerar um arquivo por corte curto. Uma política inicial segura é agrupar cenas contíguas com o mesmo mood/intensidade e limitar a duração solicitada a uma faixa que a configuração de 8 GB consiga processar.

## VRAM, desempenho e operação offline

O README oficial informa suporte a Python 3.11–3.12, CUDA recomendado e execução também em CPU/MPS/ROCm/XPU. A instalação oficial usa `uv sync`; o servidor REST pode ser iniciado com `uv run acestep-api` e escuta em `http://localhost:8001`.

Para 8 GB, há três pontos operacionais:

- O Turbo é o DiT adequado; os modelos XL exigem pelo menos 12 GB com offload e não são candidatos para esta placa.
- O LM 0.6B é o único recomendado na faixa de 6–8 GB. Deve-se usar batch 1 para deixar margem para driver, áudio e fragmentação.
- O backend `pt` é o recomendado nessa faixa. `vllm` aparece como recomendado em faixas maiores; não deve ser introduzido como requisito para a configuração de 8 GB.

A geração é local depois que ambiente e checkpoints estão instalados, porém o primeiro uso não é offline por padrão: os modelos são baixados automaticamente quando ausentes e o downloader pode consultar Hugging Face ou ModelScope. Para cumprir a exigência do Aethera:

- fazer a instalação e o download dos checkpoints em uma etapa explícita de preparação;
- apontar a configuração oficial de checkpoints para uma pasta local estável e compartilhável; o nome exato da variável deve ser confirmado na revisão do downloader usada na instalação, pois `ACESTEP_CHECKPOINTS_DIR` não aparece no `.env.example` oficial consultado;
- iniciar com `SERVER_NAME=127.0.0.1`, sem `--share`;
- desativar o verificador de atualização do launcher;
- iniciar sem rede somente depois de confirmar que os checkpoints, wheels e ambiente estão presentes; o comando offline final deve ser validado na instalação escolhida, pois não é uma garantia automática do servidor;
- falhar de forma clara quando um modelo local estiver ausente, em vez de tentar um fallback remoto.

O repositório oferece fallback offline no launcher, mas não encontrei no material oficial consultado uma garantia de que todas as etapas de inicialização, incluindo atualização e model downloader, sejam offline sem pré-configuração. Portanto, “offline” é uma condição operacional a ser testada e configurada, não um atributo automático do servidor.

## Licenças: separar quatro camadas

| Camada | Evidência primária | Leitura para o Aethera |
|---|---|---|
| Software ACE-Step 1.5 | `LICENSE` do repositório: MIT | Permite uso, modificação e distribuição sob as condições MIT, incluindo aviso de copyright/licença. |
| Pesos DiT e pacote ACE-Step publicado | Model card do `ACE-Step/Ace-Step1.5` declara MIT; o subdiretório Turbo tem 4,79 GB | Registrar o identificador do repositório, revisão/commit e licença efetivamente distribuída. Não inferir a licença de outros checkpoints ou de arquivos auxiliares sem conferir seus próprios metadados. |
| LM 0.6B/1.7B | Os checkpoints ACE-Step publicados declaram MIT; os modelos base oficiais Qwen3 correspondentes declaram Apache-2.0 | Registrar o checkpoint ACE-Step usado e manter também a atribuição/licença dos componentes upstream identificados. O rótulo do pacote derivado não elimina a necessidade de inventário. |
| Software de inferência e dependências | `pyproject.toml` lista PyTorch, Transformers, Diffusers, FastAPI, Gradio, Uvicorn, diskcache e outras dependências | Cada dependência deve ser inventariada no ambiente efetivamente instalado. As licenças oficiais consultadas incluem BSD-3-Clause para PyTorch/Uvicorn, Apache-2.0 para Transformers/Diffusers/Gradio e MIT para FastAPI. |
| Áudio gerado | O model card diz “Commercial-Ready” e afirma uso comercial do áudio gerado | Isso é uma declaração de uso do projeto, não um contrato separado de cessão de direitos sobre cada arquivo. Não registra autoria, originalidade, ausência de similaridade, proteção autoral local ou direitos sobre prompts/referências. O Aethera deve manter a faixa como “generated” e exigir revisão de direitos antes de mudar seu status de publicação. |

A licença MIT do software e dos pesos não deve ser confundida com a titularidade do áudio final. Também não há, nas fontes oficiais consultadas, um mecanismo de registro de exclusividade ou uma garantia de que dois usuários não receberão material parecido. Para o canal não comercial, a geração pode ser usada como material de produção após a validação local; para monetização, patrocínio ou exploração comercial, o Rights Manager deve continuar exigindo evidência adicional e decisão explícita.

Não enviar para o ACE-Step material de terceiros como áudio de referência sem licença. O caminho `text2music` com prompt instrumental é o mais alinhado ao objetivo de música original e evita introduzir uma segunda cadeia de direitos.

## Metadados e cache recomendados

O schema atual do Aethera já contempla `generatedMusicSource` com `providerId`, `model`, `promptHash`, `seed` e licença, mas a validação atual rejeita música gerada durante o render. Isso é uma lacuna de integração, não foi alterado nesta pesquisa.

Para cada geração, o registro futuro deve conter no mínimo:

```json
{
  "providerId": "ace-step-local",
  "softwareVersion": "1.5.0",
  "modelId": "acestep-v15-turbo",
  "modelRevision": "<commit ou revisão local>",
  "lmModelId": "acestep-5Hz-lm-0.6B",
  "lmBackend": "pt",
  "prompt": "<prompt normalizado>",
  "promptHash": "<sha256>",
  "seed": 123,
  "durationMs": 60000,
  "bpm": 110,
  "inferenceSteps": 8,
  "guidanceScale": 7,
  "taskType": "text2music",
  "outputSha256": "<sha256 do arquivo>",
  "format": "wav ou flac",
  "source": "local-only",
  "licenseEvidence": {
    "software": "MIT",
    "ditWeights": "MIT — model card/revision registrada",
    "lmWeights": "MIT — checkpoint ACE-Step/revision registrada",
    "outputStatement": "model card declara uso comercial; não é garantia de titularidade"
  },
  "timelineId": "<timeline>",
  "sceneIds": ["<cenas>"],
  "createdAt": "<ISO-8601>"
}
```

O cache deve ser imutável por hash do conteúdo e dos parâmetros. Alterar modelo, revisão, prompt normalizado, seed, duração, BPM, backend ou parâmetros de inferência deve produzir uma nova chave. A reutilização deve verificar existência, SHA-256, duração/codec e compatibilidade de licença antes de inserir a faixa na timeline. O arquivo e o manifesto devem permanecer no workspace do projeto; o cache transitório em memória do servidor ACE-Step não é suficiente para auditoria.

## Compatibilidade com os 31 SFX existentes

A integração musical é ortogonal aos 31 efeitos sonoros locais já descobertos no kit MotionVelix. Eles devem permanecer sem download, sem substituição e sem alteração no Rights Manager. O plano de áudio pode combinar:

- trilha ACE-Step local registrada como `generated`;
- ducking da música durante as janelas de palavras da narração;
- os SFX existentes por evento de transição, com seus próprios hashes e evidências;
- medição final de loudness e true peak após a soma.

O ducking deve ocorrer somente na faixa musical, preservando a inteligibilidade da narração e o ganho independente dos SFX. A medição deve ser feita no arquivo final, não apenas no grafo FFmpeg, porque a soma de trilha, voz e efeitos pode alterar o resultado.

## Decisão recomendada

1. **Aprovar a direção técnica:** ACE-Step 1.5 Turbo local é compatível com o objetivo e não exige API paga.
2. **Não implementar nesta etapa de pesquisa:** primeiro preparar os checkpoints e medir uma geração real de 30–60 s na RTX 4060 Ti 8 GB.
3. **Configuração-piloto:** Turbo + LM 0.6B + `pt`, INT8/offload automático, batch 1, `text2music`, instrumento sem voz.
4. **Manter o bloqueio de publicação:** a declaração comercial do model card não altera o canal não comercial nem autoriza mudar `legalClearance` ou o Rights Manager.
5. **Só depois do teste:** implementar o adaptador local, o cache imutável, o manifesto de licença/origem e a inserção na timeline do MotionVelix.

## Incertezas e itens que exigem confirmação

- Não foi executada uma geração na máquina-alvo; a recomendação de VRAM vem das tabelas e configurações oficiais, não de benchmark local.
- “8 GB” pode ser detectado como uma faixa inferior após reservas do driver. O fallback para DiT-only precisa ser exercitado.
- A velocidade e o consumo variam com duração, batch, quantização, compile e estado do CUDA; os números promocionais do README são medidos em outras GPUs.
- O material oficial descreve fallback offline, mas não garante que o primeiro setup, update check e download sejam offline sem preparação prévia.
- A declaração “Commercial-Ready”/uso comercial é do model card; não encontrei uma licença de output separada, uma garantia de exclusividade ou uma garantia jurídica sobre copyright do áudio gerado.
- O inventário completo de licenças transitivas ainda depende do lockfile/ambiente efetivamente instalado; as licenças citadas nesta avaliação cobrem os componentes principais consultados, não todos os pacotes opcionais de treino, VST ou plataforma.
- O API server usa job store em memória e expira resultados; o Aethera precisa persistir os artefatos e metadados localmente para reuso e auditoria.
- O contrato de geração pode evoluir; o adaptador deve negociar `/health` e `/v1/models`, validar respostas e registrar a revisão do ACE-Step usada.

## Fontes primárias consultadas

- [ACE-Step 1.5 — repositório oficial e README](https://github.com/ACE-Step/ACE-Step-1.5) — instalação, API local, modelos, faixas de VRAM e recursos.
- [LICENSE do ACE-Step 1.5](https://raw.githubusercontent.com/ACE-Step/ACE-Step-1.5/main/LICENSE) — MIT do software.
- [README/model card oficial no Hugging Face](https://huggingface.co/ACE-Step/Ace-Step1.5/raw/main/README.md) — licença MIT declarada, Turbo, afirmação de uso comercial do áudio, capacidades e model zoo.
- [Arquivos do checkpoint `acestep-v15-turbo`](https://huggingface.co/ACE-Step/Ace-Step1.5/tree/main/acestep-v15-turbo) — tamanho e identificação do checkpoint.
- [GPU compatibility oficial (`gpu_config.py`)](https://github.com/ACE-Step/ACE-Step-1.5/blob/main/acestep/gpu_config.py) — tiers, LM disponível, backend, offload, quantização e limites.
- [GPU Compatibility Guide](https://github.com/ACE-Step/ACE-Step-1.5/blob/main/docs/en/GPU_COMPATIBILITY.md) — tabela detalhada de 6–8 GB e 8–12 GB.
- [Installation Guide](https://raw.githubusercontent.com/ACE-Step/ACE-Step-1.5/main/docs/en/INSTALL.md) — Python, VRAM mínima, setup e execução do REST server.
- [`.env.example`](https://raw.githubusercontent.com/ACE-Step/ACE-Step-1.5/main/.env.example) — checkpoints, backend, bind local, download source, API key e inicialização do LM.
- [API reference oficial](https://github.com/ACE-Step/ACE-Step-1.5/blob/main/.claude/skills/acestep/api-reference.md) — endpoints e exemplos de request/response.
- [`acestep/api_server.py`](https://raw.githubusercontent.com/ACE-Step/ACE-Step-1.5/main/acestep/api_server.py) — FastAPI, fila, worker, expiração e integração das rotas.
- [`acestep/api/http/release_task_models.py`](https://raw.githubusercontent.com/ACE-Step/ACE-Step-1.5/main/acestep/api/http/release_task_models.py) — schema oficial da requisição de geração.
- [`acestep/ui/gradio/api/api_routes.py`](https://raw.githubusercontent.com/ACE-Step/ACE-Step-1.5/main/acestep/ui/gradio/api/api_routes.py) — autenticação opcional, cache de resultados, validação de caminho e rotas Gradio.
- [`pyproject.toml`](https://raw.githubusercontent.com/ACE-Step/ACE-Step-1.5/main/pyproject.toml) — versões/faixas de Python e dependências principais.
- [Qwen3-0.6B oficial](https://huggingface.co/Qwen/Qwen3-0.6B) e [Qwen3-1.7B oficial](https://huggingface.co/Qwen/Qwen3-1.7B) — licenças Apache-2.0 dos modelos upstream correspondentes.
- [Licença PyTorch](https://raw.githubusercontent.com/pytorch/pytorch/main/LICENSE), [Transformers](https://raw.githubusercontent.com/huggingface/transformers/main/LICENSE), [Diffusers](https://raw.githubusercontent.com/huggingface/diffusers/main/LICENSE), [FastAPI](https://raw.githubusercontent.com/fastapi/fastapi/master/LICENSE), [Gradio](https://raw.githubusercontent.com/gradio-app/gradio/main/LICENSE) e [Uvicorn](https://raw.githubusercontent.com/encode/uvicorn/master/LICENSE.md) — licenças dos componentes de runtime consultados.

As fontes acima são documentação, código ou model cards dos próprios projetos; não foram usados artigos, agregadores ou tutoriais de terceiros para sustentar as conclusões.
