# Planejamento técnico — Velix para produção audiovisual autônoma

Status: Fases A (execução persistida), B (formatos e roteiros longos), C (evidências e pesquisa), D (storyboard e seleção de mídia), E (narração longa e sincronização), F (compositor por formato e QA) e G (editor de linha do tempo) implementadas; Fases H–I pendentes. Decisão da Fase D: versões completas do storyboard em `velix_storyboards` no lugar de `velix_storyboard_scenes`/`velix_media_selection` (ver `docs/PLAN.md`). Progresso e evidências em `docs/PLAN.md` (seção "Velix — produção audiovisual autônoma").

## 1. Decisões de arquitetura

O Velix deve evoluir por módulos profundos, não por um novo pipeline paralelo. O seam principal será um `ProductionRun` persistido, que orquestra etapas existentes e novas por meio do TaskEngine. Cada etapa mantém sua implementação especializada, mas expõe uma interface pequena: entrada validada, artefatos, progresso, eventos, custo, direitos e estado de retomada.

Princípios:

- o TaskEngine continua sendo o único executor de tarefas de agentes e jobs duráveis;
- a UI nunca chama provedores diretamente;
- descoberta, autorização e uso final de mídia são estados diferentes;
- conteúdo de agentes, web, arquivos e templates é dado não confiável;
- nenhum arquivo externo é baixado ou código executado sem uma ação autorizada;
- projetos e vídeos atuais continuam abrindo no Dossiê;
- cada etapa é idempotente por `inputHash + configurationHash` e pode reutilizar cache;
- operações pagas exigem orçamento, estimativa e aprovação antes da execução;
- toda saída audiovisual precisa passar por validação técnica antes de ser exportável.

## 2. Diagnóstico da arquitetura atual

### Fundamentos reutilizáveis

- Desktop Electron com renderer React, preload tipado e IPC validado por Zod.
- Monorepo TypeScript com `shared`, `database`, `workspace`, `orchestrator`, `agents` e `desktop`.
- SQLite/Drizzle com migrações aditivas e repositórios específicos.
- `video_projects` separa o projeto audiovisual do projeto geral.
- `velixDiscoverySearches`, `velixMediaReferences`, `velixMediaRights`, `velixClipSuggestions`, `velixLocalAssets` e `velixMediaAnalyses` já formam o núcleo de descoberta, mídia e direitos.
- `video-script.ts` gera roteiro estruturado com contrato, cenas e blocos; hoje há limites de 12.000 caracteres e até 40 cenas, que precisarão virar limites por lote, não um limite artificial de produção.
- `video-research.ts` já integra pesquisa por agente e referências aprovadas.
- `velix-production-scenes.ts` e os modos de produção montam cenas.
- `velix-narration.ts` persiste sidecar, gera áudio, mede duração por FFprobe e salva timeline.
- `video-styles.ts`, Motion/Remotion, adaptadores de estilo, `velix-style-mix.ts` e FFmpeg já suportam render, composição e mistura por cena.
- `velix-collage` demonstrou o padrão de provider opcional, chave cifrada, aprovação humana, QA e Rights Manager.
- `velix-motion-jobs`, `velixEditorialVersions`, `velixEditorialDecisions`, `workflowCheckpoints` e `tasks/task_steps/task_events` oferecem pontos de persistência reutilizáveis.
- `TaskEngine` já registra passos, retomada, capacidade, eventos e falhas; a nova produção deve usá-lo, não duplicá-lo.

### Lacunas principais

1. O fluxo atual ainda é centrado em vídeo curto/Dossiê: formato, gênero, duração, público e orçamento não formam um contrato único de produção.
2. Roteiro, pesquisa, storyboard, narração, mídia e render têm persistências relacionadas, mas não uma execução comum com dependências e checkpoints visíveis.
3. Não há modelo de storyboard completo com edição, bloqueio, substituição, ordenação e vínculo explícito entre frase, evidência, mídia e cena.
4. A descoberta registra referências e direitos, mas a seleção ainda precisa de ranking semântico, diversidade, atualidade, qualidade e adequação de formato.
5. A narração usa tempos reais quando o áudio está pronto, porém a geração longa, união de blocos, continuidade de voz e sincronização por frase precisam de uma etapa própria.
6. O render conhece estilos, base video, áudio e FFmpeg, mas não existe um relatório único de qualidade, custo e rastreabilidade por exportação.
7. O editor atual do Estúdio é formulário + prévia; ainda não é uma timeline multipista.
8. Shorts e formatos derivados não têm um modelo de recorte editorial que preserve contexto e identidade.

## 3. Arquitetura proposta

### Módulos

`packages/shared`

- contratos Zod de formato, gênero, briefing, roteiro, evidência, storyboard, mídia, narração, render, custo e qualidade;
- enums versionados e discriminados por tipo;
- funções puras de orçamento, cálculo de palavras, áreas seguras, ranking e validação.

`packages/database`

- tabelas de produção, etapas, artefatos, orçamento, evidências, storyboard, mídia selecionada, versões e relatórios;
- repositórios profundos para carregar o estado agregado sem espalhar joins pela UI.

`packages/orchestrator`

- `ProductionRunService`: cria, agenda, pausa, retoma, cancela e consulta uma produção;
- `ProductionStageAdapter`: seam entre etapa persistida e implementação concreta;
- adaptadores para roteiro, pesquisa, verificação factual, storyboard, mídia, narração, sincronização, composição, render, QA e exportação;
- o TaskEngine executa cada etapa e persiste o resultado.

`packages/workspace`

- regras puras e I/O confinado ao projeto: formatos, cenas, timeline, direitos, seleção, safe areas, normalização, FFmpeg e FFprobe;
- adaptadores de provedores não devem morar aqui quando exigirem credenciais externas.

`apps/desktop/src/main`

- IPC fino, autenticação de sender, resolução de projeto, secrets cifrados e integração com TaskEngine;
- nenhum algoritmo editorial relevante no handler.

`apps/desktop/src/renderer`

- wizard de produção, painel de execução, storyboard e editor timeline;
- React Query para estado remoto, eventos de progresso e invalidação após mutações;
- visualizações acessíveis e compatíveis com a identidade atual.

### Fluxo de dependências

```text
Briefing + formato + orçamento
        ↓
Pesquisa factual → evidências aprovadas
        ↓
Roteiro versionado → verificação editorial
        ↓
Storyboard por cena → mídia/licença/revisão
        ↓
Narração real → palavras/frases temporizadas
        ↓
Sincronização → composição por formato/estilo
        ↓
Render normalizado → QA técnico/editorial
        ↓
Exportação principal → derivados Shorts/Reels/TikTok
```

Cada seta é uma dependência persistida. Uma falha em uma etapa não invalida as anteriores.

## 4. Contratos centrais

```ts
type VideoFormat = {
  id: 'youtube-long' | 'youtube-short' | 'instagram-reels' | 'tiktok' | 'square' | 'custom';
  width: number;
  height: number;
  aspectRatio: string;
  fps: number;
  safeArea: { top: number; right: number; bottom: number; left: number };
};

type ProductionBrief = {
  projectId: string;
  format: VideoFormat;
  productionType: ProductionType;
  topic: string;
  targetDurationSeconds: number;
  targetWords?: number;
  language: string;
  audience: string;
  tone: string;
  narrativeStyle: string;
  researchDepth: 'light' | 'standard' | 'deep';
  sourceCount: number;
  pace: 'slow' | 'standard' | 'fast';
  budgetUsd: number;
};

type ProductionStage = {
  id: string;
  runId: string;
  kind: StageKind;
  status: 'pending' | 'running' | 'paused' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';
  inputHash: string;
  outputArtifactIds: string[];
  progress: number;
  retryCount: number;
  costEstimateUsd: number;
  actualCostUsd: number;
  checkpoint: Record<string, unknown>;
  error?: { code: string; message: string; retryable: boolean };
};
```

O contrato real deve ser versionado (`schemaVersion`) e aceitar campos desconhecidos apenas onde há payload de provedor. Não usar `any` para atravessar o seam.

### Storyboard

Cada cena terá `id`, `startMs`, `endMs`, `narrationSegmentIds`, `claimIds`, `visualObjective`, `sceneType`, `searchTerms`, `assetId`, `referenceId`, `rightsStatus`, `crop`, `camera`, `animation`, `transition`, `onScreenText`, `captions`, `music`, `sfx`, `locked` e `reviewStatus`.

Uma cena só pode entrar no render se: seu intervalo é válido, a mídia é autorizada ou a composição é gerada internamente, o texto está dentro da área segura e todas as afirmações relevantes têm evidência ou estão marcadas como opinião/estimativa/previsão.

## 5. Modelo de persistência

Migrações aditivas sugeridas, confirmando sempre o próximo número:

- `velix_production_runs`: briefing, formato, tipo, status, orçamento, custo estimado/real, versão do contrato e timestamps;
- `velix_production_stages`: execução das etapas e checkpoint resumido;
- `velix_production_artifacts`: arquivos, JSON, hashes, MIME, duração, resolução e etapa de origem;
- `velix_production_approvals`: aprovação humana por etapa, escopo, usuário local, decisão, nota e timestamp;
- `velix_editorial_claims`: afirmação, classificação, confiança, fonte sustentadora e cenas vinculadas;
- `velix_storyboards`: versão do storyboard e conteúdo normalizado;
- `velix_storyboard_scenes`: cena editável, posição, tempos, asset, evidências e revisão;
- `velix_media_selection`: seleção final, score, diversidade, motivo e ordem;
- `velix_budgets`: limites por categoria, reserva, consumido, moeda e política de aprovação;
- `velix_quality_reports`: checks, severidade, evidência, sugestões e decisão de exportação;
- `velix_derivatives`: vínculo entre exportação principal e Shorts/derivados.

Os caminhos são sempre relativos ao `video_projects.rootPath`, validados contra traversal e gravados com hash. Arquivos temporários ficam em diretório de execução e são removidos após sucesso ou retidos com TTL após falha.

## 6. Fluxo de produção detalhado

### 6.1 Briefing e formato

O wizard apresenta formato e tipo primeiro. O formato calcula resolução, proporção, safe areas, legendas, composição e preset de exportação. Formato personalizado exige largura, altura, FPS e área segura válidos.

Palavras-alvo são calculadas por duração e velocidade, com intervalo visível e override manual. A produção deve mostrar a diferença entre meta e estimativa, incluindo pausas e trechos sem voz.

### 6.2 Roteiro longo

Para mais de 2.000 palavras, dividir por capítulos com uma janela de contexto compartilhado: resumo canônico, entidades, termos, fatos, decisões estilísticas e últimos/ próximos beats. Cada bloco retorna contrato parcial; o consolidador valida continuidade, remove repetição e produz uma versão única. Nenhum capítulo aprovado é reescrito silenciosamente.

O limite operacional deve ser por lote, tempo e orçamento. A versão final pode ter 3.000, 5.000 ou mais palavras sem aumentar artificialmente o limite de uma chamada.

### 6.3 Pesquisa e evidências

O pesquisador cria consultas por trecho e classifica resultados como descoberta, fonte de evidência, mídia candidata ou material não utilizável. Cada afirmação recebe fonte, URL, datas, trecho sustentador e confiança. A interface mostra “encontrado” separado de “autorizado”.

Vídeos públicos, notícias e screenshots permanecem bloqueados para render até revisão de direitos. A alternativa padrão para direito incerto é composição própria, fonte licenciada ou pedido explícito de autorização.

### 6.4 Storyboard e seleção

O storyboard nasce automaticamente, mas toda cena pode ser editada, substituída, bloqueada, duplicada ou reordenada. O ranking de mídia combina relevância semântica, qualidade, resolução, proporção, duração, licença, atualidade, diversidade e consistência estética. A função deve ser pura e testável; o download é um adaptador posterior e autorizado.

Se não houver asset adequado, a cena recebe um fallback explícito: tipografia, documento, gráfico verificado ou animação. Nunca usar uma imagem aleatória para preencher tempo.

### 6.5 Narração e sincronização

Gerar blocos com o mesmo modelo/voz e um manifesto de continuidade. Unir os áudios, medir o resultado por FFprobe e extrair palavras/frases temporizadas. A timeline das cenas usa tempos reais, não caracteres. Desvios, palavras ausentes e pausas longas aparecem como problemas revisáveis.

### 6.6 Composição, render e QA

O compositor recebe `VideoFormat`, storyboard aprovado, narração, estilo, overlays, mídia autorizada e trilhas. O render usa o motor existente (kit, Remotion e FFmpeg), normaliza cada segmento, concatena sem perder áudio e registra comandos/versões de forma redigida.

QA mínimo: resolução, proporção, FPS, duração, streams, áudio, silêncio, legenda, safe areas, arquivos corrompidos, cenas vazias/duplicadas, rights status, afirmações sem fonte e custo acima do orçamento. O MP4 só passa a `exportable` quando os checks bloqueantes estão verdes ou foram aprovados explicitamente.

## 7. Derivados de Shorts

O motor cria candidatos por unidade narrativa, não por corte central: gancho, contexto mínimo, payoff e fechamento. Cada candidato informa origem, início/fim, motivo, score e afirmações preservadas. Depois aplica enquadramento 9:16, safe areas, títulos, legendas e identidade. O usuário aprova cada derivado antes da exportação em lote.

## 8. Interface e UX proposta

### Wizard “Nova produção”

1. Briefing e formato.
2. Tipo, público, idioma, ritmo e duração/palavras.
3. Pesquisa e orçamento.
4. Roteiro e fontes.
5. Storyboard.
6. Narração e sincronização.
7. Composição e exportação.

Cada etapa mostra entrada, saída, custo, dependências, estado e botão de retomada. O usuário pode abrir o resultado enquanto a etapa seguinte processa.

### Workspace da produção

Layout em três regiões: navegador de etapas à esquerda; canvas/timeline no centro; painel contextual à direita. O storyboard usa cartões com tempo, frase, evidência, asset, licença e score. Drag-and-drop precisa de alternativa por teclado, foco visível e anúncio de posição.

### Timeline

Faixas separadas para narração, música, SFX, vídeo, imagens, gráficos, texto e legendas. A prévia draft usa baixa resolução; a produção mostra marcadores de direitos, afirmações e problemas de QA diretamente na cena.

### Direção visual

Usar o Design System existente: preto/OLED, laranja primário, Inter, contraste mínimo 4.5:1, ícones Lucide, foco visível, 44px para controles acionáveis, sem emojis como ícones, sem scroll horizontal e suporte a 375/768/1024/1440px. Motion deve respeitar `prefers-reduced-motion`; animação comunica estado, nunca esconde progresso ou erro.

## 9. Provedores e custos

Criar adapters internos para `AgentAdapter`, pesquisa web/licenciada, geração de imagem, mídia, TTS e análise. A interface recebe dependências; testes usam fake adapters. Chaves ficam em stores cifrados; nunca em banco, renderer, URL ou log.

Categorias de orçamento: pesquisa, LLM, TTS, imagem, aquisição de mídia, render e armazenamento. Cada adapter retorna uso estimado e real. Se o custo provável exceder reserva ou orçamento, o estágio vai para `awaiting_approval` sem chamada paga.

O custo não deve ser calculado apenas no frontend. O backend persiste a estimativa, reserva antes de executar e reconcilia o custo real ao terminar.

## 10. Segurança e direitos

- read-only continua read-only, mesmo em projeto com Acesso total;
- conteúdo de fontes, prompts e respostas nunca vira instrução de execução;
- URLs e caminhos são validados, com allowlist de protocolos e raiz do projeto;
- mídia sem `verified_allowed` não entra no render final;
- créditos e restrições são derivados do Rights Manager;
- screenshots e vídeos de terceiros exigem fundamento explícito;
- logs redigem chaves, tokens, cookies, prompts sensíveis e respostas brutas;
- geração de IA registra provedor, modelo, prompt hash, aprovação e licença/termos;
- exportação guarda manifesto de dependências e direitos junto ao artefato.

## 11. Plano de implementação por fases

### Fase A — contratos e execução persistida

Criar `ProductionBrief`, `ProductionStage`, `Artifact`, `Budget`, `QualityReport` e migrações. Implementar `ProductionRunService` sobre TaskEngine, com checkpoint, retry, cancelamento e retomada. Aceite: reiniciar o app durante uma etapa e continuar sem duplicar artefatos.

### Fase B — formatos e roteiros longos

Adicionar catálogo de formatos/tipos, cálculo de palavras e geração por capítulos. Migrar o roteiro atual para adaptador compatível, mantendo Dossiê v1. Aceite: produzir 3.000+ palavras em múltiplos lotes, consolidar sem repetição e preservar projetos atuais.

### Fase C — evidências e pesquisa audiovisual

Unificar claims, fontes, busca por trecho, cache e revisão de direitos. Aceite: nenhuma afirmação factual sem evidência aprovada; material encontrado, mas não autorizado, aparece apenas como candidato.

### Fase D — storyboard e seleção de mídia

Persistir storyboard versionado, ranking, diversidade, substituição e bloqueio. Aceite: editar/reordenar/substituir uma cena, reiniciar e recuperar exatamente o estado; nenhuma cena sem asset autorizado ou fallback declarado.

### Fase E — narração longa e sincronização

Unir blocos de TTS, medir áudio, gerar palavras/frases, sincronizar e reportar desvios. Aceite: cenas usam tempos reais do MP4, com timeline reproduzível e alerta de palavras ausentes.

### Fase F — compositor por formato e QA

Ligar storyboard ao kit/Remotion/FFmpeg, safe areas, legendas, trilhas, validações e relatório. Aceite: cada formato produz MP4 com resolução, áudio, duração e proporção corretos; falhas bloqueantes impedem exportação.

### Fase G — editor timeline

Evoluir o Estúdio para multipista com preview draft, edição por teclado, locks e checkpoints. Aceite: mover/dividir/substituir uma cena e renderizar apenas o necessário, sem perder direitos ou sincronização.

### Fase H — Shorts e derivados

Candidatos narrativamente coerentes, reframing, identidade e exportação separada. Aceite: cada Short é compreensível isoladamente e tem vínculo com o trecho de origem.

### Fase I — custos, observabilidade e hardening

Orçamento real, telemetria local, cache, limites, matriz de falhas, migração/rollback e distribuição. Aceite: custo previsto e real por produção, retomada após rede/CLI/render falhar e nenhum segredo nos logs.

## 12. Testes

- unidade: schemas, cálculo de palavras, formatos, safe areas, ranking, diversidade, claims, orçamento, máquina de estados e redaction;
- integração: migrações, repositórios, TaskEngine, adapters fake, FFprobe/FFmpeg, TTS sidecar, cache e Rights Manager;
- E2E desktop: wizard, aprovação, storyboard, timeline, pausa, retomada, cancelamento, orçamento excedido e exportação;
- E2E Motion: matriz de formatos, legendas, safe areas, movimento reduzido e render real;
- visual: 375/768/1024/1440, claro/escuro, contraste, foco e snapshots das cenas;
- segurança: traversal, URL, prompt injection em fontes, segredo em logs, direitos não aprovados e read-only;
- regressão: Dossiê atual, estilos existentes, colagem IA opcional, canal e projetos antigos.

## 13. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Custo imprevisível | orçamento reservado, aprovação antes do pago e cache por hash |
| Roteiro longo inconsistente | capítulos, resumo canônico, validação e versões aprovadas |
| Direitos ambíguos | estado separado de descoberta/autorização e bloqueio no render |
| Mídia inadequada | ranking explicável, diversidade, revisão e fallback próprio |
| Render longo falha | etapas idempotentes, segmentos, checkpoints e FFprobe |
| Provedor indisponível | adapters, retry controlado, fallback local e retomada |
| UI complexa | wizard progressivo, painel contextual, timeline draft e acessibilidade |
| Migração incompatível | migrações aditivas, leitura dos formatos antigos e rollback por versão |

## 14. Rollback e definição de pronto

Cada fase deve ser ativada por capability flag por projeto. Em rollback, interromper novas execuções, preservar artefatos e permitir abrir/exportar produções antigas com o pipeline anterior. Nunca apagar mídia física ao desvincular uma seleção.

O programa estará pronto quando uma produção nova puder:

1. escolher formato/tipo e orçamento;
2. gerar roteiro curto ou longo por lotes;
3. rastrear afirmações e direitos;
4. revisar storyboard e mídias;
5. gerar narração com tempos reais;
6. compor e renderizar usando o motor existente;
7. passar por QA técnico/editorial;
8. exportar principal e derivados;
9. pausar, reiniciar e retomar sem perder estado;
10. apresentar custo previsto/real e manifesto de fontes/licenças.

Cada item precisa de evidência de teste correspondente, relatório de qualidade persistido e compatibilidade verificada com o Dossiê e os projetos existentes.
