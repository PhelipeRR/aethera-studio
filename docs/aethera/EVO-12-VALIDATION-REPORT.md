# EVO-12 — Relatório de Validação Real de Aprendizado e Autonomia Cinematográfica

**Data:** 2026-11-14  
**Escopo:** Auditoria real + execução dos Experimentos 1, 2, 3 e 4 sobre `@neuralbridge/cinema` e `@neuralbridge/aethera-desktop`.

---

## 1. Auditoria Inicial (Antes das Correções)

Antes de corrigir as lacunas encontradas, a auditoria do código revelou três desconexões críticas:
1. **`renderRealCinemaMp4` (`packages/cinema/src/render/real-renderer.ts`) não consultava o `AetheraEvolutionCore`:** os títulos padrão (`ATO I - Abertura Cinematografica`, `ATO II - Promessa & Conflito`, `ATO VI - Resolucao & Aethera Studio`), a barra animada de motion graphics e o tamanho fixo de fonte (`fontsize=34`) eram sempre aplicados, mesmo após registro de preferências no `evolution-store.json`.
2. **`cinema:render-real-mp4` (`apps/aethera-desktop/src/main/aethera-ipc.ts`) não repassava `evolutionCore` nem o `prompt` original ao renderizador.**
3. **`probeLocalMediaForAcademy` (`packages/cinema/src/evolution/academy-engine.ts`) apenas lia metadados básicos de `ffprobe` (`durationSec`, `width`, `height`, `fps`)** — sem medir cortes de cena (`scdet`), loudness (`ebur128`), true peak ou silêncios.

---

## 2. Correções Seguras Aplicadas

1. **`packages/cinema/src/evolution/evolution-core.ts`:**
   - `classifyHumanFeedback` atualizado para reconhecer `"Não quero..."` como `explicit_preference` e rotear corretamente `cards`/`assinatura`/`fontes`/`imagens reais`.
   - Adicionado `resolveProductionDirectives({ prompt, genre, projectId })` para traduzir memórias validadas em diretivas concretas (`suppressActCards`, `suppressAetheraSignature`, `discreteTypography`, `preferRealImages`, `elaborateMotionGraphics`) e honrar exceções explícitas no prompt sem apagar a preferência geral.
2. **`packages/cinema/src/render/real-renderer.ts` e `apps/aethera-desktop/src/main/aethera-ipc.ts`:**
   - `renderRealCinemaMp4` passou a aceitar `evolution`, `genre` e `prompt`, registrar `DirectorDecisionRecord` com `consultedMemoryIds` e alterar de fato o filtro FFmpeg (`drawtext`, `fontsize=22/15` discreto vs `36`, remoção de `ATO I/II/III` e de `& Aethera Studio`, remoção da barra animada em documentários discretos).
3. **`packages/cinema/src/evolution/academy-engine.ts`:**
   - `probeLocalMediaForAcademy` passou a executar `probeRealMp4` (FFmpeg `scdet=threshold=12`, `ebur128`, `silencedetect`), extraindo ritmo médio (`s/plano`), cortes, LUFS integrado e true peak reais.

---

## 3. Resultados dos 4 Experimentos (`packages/cinema/test/evo12-experiments.test.ts`)

| Experimento | Resultado | Evidências Verificadas |
| :--- | :---: | :--- |
| **1. Aprendizado com correção humana** | **Aprovado** | Antes: `doc-before.mp4` renderizou `ATO I - Abertura Cinematografica`. Após feedback exato (`explicit_preference`, `validated`) e reinício simulado (`new AetheraEvolutionCore(evolutionPath)`), `doc-after.mp4` aplicou `suppressActCards=true`, `suppressAetheraSignature=true`, `discreteTypography=true`, `preferRealImages=true` sem repetir a instrução. Pedido explícito posterior (`"incluir card de ATO I na abertura"`) gerou exceção pontual (`overriddenDirectives=['suppressActCards']`) preservando `suppressAetheraSignature=true`. |
| **2. Academy estudando material real** | **Parcial (sinal técnico real; sem visão semântica)** | Vídeo MP4 real sondado com `ffprobe` + `ffmpeg` (`durationSec > 5`, `sceneCutsCount`, `integratedLufs`, `truePeakDbtp` medidos) + documento técnico ingerido, validado por exercício (`qualityScore=92`, `passed=true`) e recuperado em nova instância via `askAcademy` com citações. |
| **3. Colaboração real entre diretores** | **Aprovado** | Narração de `4800ms` em cena de `3000ms` (limite bruto `8000ms`): `sound_director` levantou o conflito; `editing_director` propôs estender para preservação da fala (`impactScore=88`); `narrative_director` propôs condensar (`impactScore=74`); `general_director` escolheu `editing_director`; `quality_supervisor` validou (`validatedByQuality=true`); clipe da timeline atualizado para `5s` e renderizado em `collab.mp4` (`durationSec >= 4.5s`). |
| **4. Aprendizado longitudinal (Antes vs Depois)** | **Aprovado** | Reincidência de cards `ATO I/II/III` e assinatura Aethera caiu de `100%` (Antes) para `0%` (Depois) sem novas correções humanas; 0 regressões nos testes existentes; diferenciação mantida entre testes automatizados, sonda técnica (`ffprobe`/`ebur128`) e avaliação artística humana. |

---

## 4. Classificação Honesta de Capacidades

### Operacionais (Comprovadas)
- Persistência atômica e recuperação entre reinícios (`AetheraEvolutionCore`, `AetheraAcademyEngine`).
- Classificação de feedback humano, versionamento, rollback, desativação e exclusão.
- Aplicação autônoma de preferências aprendidas e exceções explícitas no renderizador FFmpeg (`real-renderer.ts`) e no IPC Electron (`aethera-ipc.ts`).
- Resolução colaborativa de conflitos de duração de narração (`resolveNarrationDurationConflict`) com registro auditável de decisões.

### Parciais
- **Estudo Multimodal na Aethera Academia:** a Academia executa análise técnica real de sinal audiovisual via `ffprobe`/`ffmpeg` (duração, FPS, resolução, cortes `scdet`, loudness `ebur128`, true peak e silêncios) e extração de texto em documentos `.md`/`.txt`, **mas ainda não possui capacidade de estudo multimodal semântico** (não interpreta quadros visuais via Vision LLM, não transcreve fala via Whisper nativo no fluxo de ingestão e não extrai texto de PDFs binários sem parser dedicado).
- **Aplicação automática de técnicas da Academia no renderizador:** conhecimentos da Academia são sincronizados na memória evolutiva e consultados no DAG, porém apenas diretivas tipadas de `resolveProductionDirectives` alteram automaticamente o filtrograph FFmpeg hoje.

### Simuladas / Limitações Declaradas
- Nenhum resultado de áudio/vídeo foi simulado nos testes EVO-12 (os MP4s foram renderizados e sondados via FFmpeg/FFprobe reais), porém a avaliação **artística/estética humana** continua sendo atribuição do usuário na Sala de Revisão, não substituída por métricas numéricas.

---

## 5. Próximas Correções Necessárias

1. Integrar extrator de PDF (`pdf-parse` ou `pdftotext`) e transcrição Whisper no `AetheraAcademyEngine.ingestMaterial` para PDFs binários e faixas de fala.
2. Integrar Vision LLM / análise de keyframes para que a Academia descreva composição, enquadramento e iluminação semântica de vídeos de referência (estudo multimodal completo).
3. Expandir `ProductionDirectives` para consumir diretamente parâmetros numéricos aprendidos na Academia (ex.: `targetLufs`, `targetAvgShotSec`).
