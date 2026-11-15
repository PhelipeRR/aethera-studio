# Plano de Arquitetura e Implementação — Aethera Creative Studio

**Status:** Proposta arquitetural aguardando aprovação (nenhuma implementação iniciada)  
**Data:** 2026-11-15  
**Escopo:** Novo módulo de identidade visual e composição em camadas dentro do **Aethera Studio** (`apps/aethera-desktop` + pacote dedicado `@neuralbridge/creative-studio` ou extensão modular em `@neuralbridge/cinema`).

---

## 1. Objetivo

Transformar o **Aethera Studio** de um estúdio focado em produção de vídeo em uma plataforma completa de **produção audiovisual e identidade visual** para criadores de conteúdo, entregando:

- **Criador de Thumbnails** (com extração inteligente de frames e contexto do vídeo/roteiro do Cinema Pipeline)
- **Criador de Banners** (`2560 × 1440`, guias de área segura `1546 × 423`, prévias desktop/mobile/TV)
- **Criador de Avatares** (`≥ 800 × 800`, logos, monogramas, mascotes, recorte circular, versões clara/escura/transparente)
- **Criador de Marca d'Água** (`150 × 150` com transparência real, versões monocromáticas, aplicação automática e idempotente nos vídeos do Cinema Pipeline)
- **Editor Profissional por Camadas** (não destrutivo, editável, histórico undo/redo, edição localizada por prompt)
- **Brand Kit por Canal** (paleta, tipografia, logos, avatar, marca d'água, presets)
- **Thumbnail Lab** (comparação visual lado a lado de 3 variações — ex.: Impacto / Tecnologia / Cinematográfica — com pontuação heurística de legibilidade, contraste e composição, sem alegar previsão de CTR real)

O sistema opera de forma autônoma com **Quality Gate** automático, exigindo aprovação humana final antes da publicação/exportação definitiva quando configurado.

---

## 2. Auditoria de Reuso no Ecossistema Atual

A implementação reaproveitará diretamente a infraestrutura já existente no repositório:

| Capacidade | Onde já existe no repositório | Como será reutilizada |
|---|---|---|
| **Motores de raciocínio (4 engines)** | `apps/aethera-desktop/src/main/aethera-ipc.ts` (`ClaudeCliAdapter`, `CodexCliAdapter`, `claudeGatewaySecretStore` / `resolveClaudeGatewayEnv`) e `antigravity-cli.ts` (`detectAntigravityCli`, `runAntigravityPrompt`) | Orquestração colaborativa com fallback automático (RF-07): qualquer agente disponível executa o fluxo completo se os demais estiverem offline. |
| **Visão & Crítica Visual** | `packages/cinema/src/qc/visual-critic.ts` (`createAntigravityCliVisionProvider`, `VisualCriticProposal`) | Base para inspeção visual semântica no Quality Gate (legibilidade, cortes, fidelidade às referências e ao vídeo). |
| **Análise de Vídeo & Frames** | `packages/cinema/src/qc/real-media-probe.ts` (`extractVerificationFrames`, `probeRealMp4`, `detectMediaAnomalies`) e `apps/aethera-desktop/src/main/cinema-pipeline.ts` | Extração real de frames via `ffmpeg`/`ffprobe`, leitura de cenas/roteiro/narração do projeto Cinema. |
| **Renderização & VFX** | `packages/cinema/src/render/real-renderer.ts` e `packages/cinema/src/vfx/vfx-typography.ts` | Reaproveitamento de presets tipográficos, filtros FFmpeg e aplicação de marca d'água no render final do vídeo. |
| **Segurança de Caminhos & Cache** | `apps/aethera-desktop/src/main/cinema-cache.ts` (`isPathStrictlyInside`, `computeFileSha256`) | Validação estrita de armazenamento gerenciado e referências portáveis (sem caminhos absolutos persistidos). |
| **Persistência SQLite** | `packages/database/migrations/` (última: `0120_aethera_editorial_plans.sql`) e `aethera-studio.db` | Novas migrações aditivas (`0121+`) para Brand Kits, Projetos Creative Studio, Camadas/Versões e Auditorias. |
| **Backup Geral** | `apps/aethera-desktop/src/main/system-backup.ts` (`exportSystemBackup`, `restoreSystemBackup`) | Inclusão dos Brand Kits, projetos editáveis e assets gerenciados do Creative Studio no pacote de backup. |

---

## 3. Princípios Arquiteturais

1. **Separação estrita entre Raciocínio e Renderização Visual**
   - Claude Code, Codex CLI, Antigravity CLI e Claude Gateway atuam exclusivamente em planejamento criativo, direção de arte, roteiro visual, revisão semântica e geração de planos de composição estruturados.
   - A renderização e manipulação de pixels ocorrem no motor gráfico (**híbrido local-first**: `FFmpeg` + `Sharp` + `SVG/Canvas` para composição determinística, com **Image Generation Adapter** plugável para modelos de geração/remoção de fundo locais ou externos).
2. **Resiliência Single-Agent (Fallback Automático)**
   - Distribuição ideal: Claude Code (direção criativa), Codex CLI (composição técnica/JSON), Antigravity (análise/refinamento visual), Claude Gateway (roteamento/revisão semântica).
   - Se apenas 1 motor estiver disponível, ele assume todas as etapas de planejamento e revisão sem bloquear a criação.
3. **Composições Sempre Editáveis**
   - Nenhuma arte nasce apenas como imagem achatada. A fonte da verdade é um **Documento de Composição por Camadas** versionado (fundo, sujeito recortado, overlays/VFX, tipografia, logo/marca d'água, guias).
4. **Fidelidade ao Vídeo Real**
   - Para thumbnails derivadas do Cinema Pipeline, o fluxo prioriza frames reais e elementos do vídeo/roteiro, evitando inventar personagens ou eventos incompatíveis.
5. **Portabilidade e Segurança**
   - Assets armazenados em diretório gerenciado do app, referenciados por ID/caminho relativo portátil.
   - Conteúdo de prompts, roteiros e metadados externos tratado como dado não confiável (sanitização antes de compor prompts de agentes ou comandos `ffmpeg`).

---

## 4. Componentes do Módulo (9 Serviços)

1. **`CreativeOrchestrator`**: coordena os 4 motores técnicos com fallback automático; separa etapas de planejamento, análise, composição e revisão.
2. **`AssetIngestionService`**: importa imagens, vídeos, logos, fontes e referências para o armazenamento gerenciado com hash SHA-256 e metadados portáveis.
3. **`VideoFrameAnalyzer`**: extrai frames em timestamps estratégicos via `ffmpeg`/`ffprobe`, cruza com cenas/narração do `CinemaPipeline` e ranqueia momentos de maior impacto visual e movimento.
4. **`CompositionPlanner`**: transforma prompt + Brand Kit + análise de frames/mídias em um grafo de camadas estruturado para o tipo de arte (`thumbnail`, `banner`, `avatar`, `watermark`).
5. **`ImageGenerationAdapter`**: interface plugável com implementação **local-first** (`Sharp` + `SVG/Canvas` + `FFmpeg` para recorte/composição/efeitos/motion preview) e adaptadores opcionais para remoção de fundo / geração de imagem quando configurados.
6. **`LayeredCanvasEditor`** (Core + UI React): canvas interativo com transformação, rotação, alinhamento, máscaras/recortes, texto editável, efeitos não destrutivos, undo/redo, auto-save e edição localizada por prompt.
7. **`BrandKitManager`**: CRUD de identidade por canal (nome, paleta, fontes, logo, avatar, marca d'água, presets de thumbnail e referências visuais).
8. **`QualityGateService`**: auditoria técnica determinística + revisão visual:
   - Legibilidade em miniatura (`168×94` / mobile), contraste, elementos cortados, resolução/proporção, qualidade de recorte, consistência com Brand Kit, fidelidade ao vídeo/referências, área segura de banner (`1546×423`) e canal alfa real em marca d'água.
   - Bloqueia aprovação automática se houver problema crítico.
9. **`ExportService`**: exporta `PNG`, `JPG`, `WebP`, projeto editável (`.aethera-creative.json`), prévia animada opcional (`MP4`/`WebP`) para thumbnails, e aplica marca d'água de forma idempotente no `CinemaPipeline` (via metadado/marcador de camada aplicada para evitar duplicação em reexportações).

---

## 5. Dimensões, Formatos e Guias

| Arte | Dimensão Padrão | Guias / Requisitos |
|---|---|---|
| **Thumbnail** | `1280 × 720 px` (16:9) | Prévia em tamanho real e miniatura de feed; opção de prévia animada (MP4/WebP), exportação principal estática. |
| **Banner** | `2560 × 1440 px` | Área segura conservadora `1546 × 423 px` centralizada; prévia simulada para Desktop, Mobile e TV. |
| **Avatar** | `800 × 800 px` (ou superior, 1:1) | Prévia de recorte circular; variantes clara, escura e transparente. |
| **Marca d'Água** | `150 × 150 px` (1:1) | Canal alfa transparente real, opacidade configurável, versão monocromática, prévia sobreposta a frames de vídeo. |

---

## 6. Fases de Implementação

### Fase CS-1 — Fundação, Dados, Motor de Composição e Exportação
- **Pacote / Domínio**: estruturar `@neuralbridge/creative-studio` (ou submódulo isolado) com schemas Zod para `BrandKit`, `CreativeProject`, `CompositionDocument`, `Layer` (background, subject, text, vfx, shape, watermark) e `QualityAuditReport`.
- **Persistência**: migração SQLite `0121_aethera_creative_studio.sql` + repositórios em `@neuralbridge/database`.
- **Serviços base**: `AssetIngestionService`, `BrandKitManager`, `ImageGenerationAdapter` (motor local-first `Sharp` + `SVG` + `FFmpeg` + interface plugável) e `ExportService` (PNG/JPG/WebP + JSON editável).
- **Testes**: unitários de schema, composição determinística, dimensões e exportação real de imagens.

### Fase CS-2 — Editor Profissional por Camadas (UI + Estado)
- **Canvas Interativo** em `apps/aethera-desktop`: nova aba/workspace **Creative Studio**.
- **Edição por camadas**: seleção, ordem z, visibilidade, opacidade, transformação (posição/escala/rotação), alinhamento, máscaras/recortes, texto editável com estilo (contorno, sombra, gradiente), efeitos não destrutivos.
- **Produtividade**: pilha undo/redo, auto-save em SQLite, guias visuais (área segura do banner, recorte circular do avatar, grade/terços).
- **Edição localizada por prompt**: aplica alterações somente nas camadas alvo sem destruir o restante da composição.
- **Testes**: unitários de estado/undo-redo + integração de persistência e renderização.

### Fase CS-3 — Extração Inteligente de Frames, Orquestração 4 Motores, Quality Gate e Thumbnail Lab
- **`VideoFrameAnalyzer`**: extração de frames via `ffmpeg`/`ffprobe`, integração com roteiro/cenas do `CinemaPipeline`, detecção de quadros de alto impacto (contraste, nitidez, movimento, ausência de black-frame/blur).
- **`CreativeOrchestrator`**: colaboração Claude Code + Codex CLI + Antigravity CLI + Claude Gateway com fallback RF-07 para 1 agente funcional.
- **`QualityGateService`**: auditoria automática bloqueante para falhas críticas + pontuação heurística de legibilidade/contraste/composição.
- **Thumbnail Lab**: geração e comparação lado a lado de 3 variações (A — Impacto, B — Tecnologia, C — Cinematográfica) com aprovação humana.
- **Testes**: integração multiagente (incluindo fallback com 1 agente) e auditoria de qualidade.

### Fase CS-4 — Os 4 Criadores Especializados + Integração Automática com Cinema Pipeline & Backup
- Fluxos dedicados para **Thumbnail**, **Banner** (previews desktop/mobile/TV), **Avatar** (claro/escuro/transparente + recorte circular) e **Marca d'Água** (monocromática, transparente, prévia em vídeo).
- **Ganchos no `CinemaPipeline`**:
  - Geração automática de proposta de thumbnail ao concluir um vídeo, sem obrigar troca de módulo.
  - Aplicação automática de marca d'água com proteção idempotente anti-duplicação.
- **Backup Geral**: incluir tabelas e diretório gerenciado do Creative Studio em `system-backup.ts`.

### Fase CS-5 — Validação Real E2E e Fechamento
- Execução de cenários reais (sem mocks como única evidência):
  1. Thumbnail de Cyberpunk 2077 usando frames reais de gameplay.
  2. Banner de canal gamer futurista (`2560 × 1440` + safe area).
  3. Avatar de mascote tecnológico (`800 × 800` + recorte circular).
  4. Marca d'água transparente (`150 × 150` PNG com alfa real e aplicação única em vídeo).
- Verificação de dimensões, canal alfa, legibilidade, persistência após reload, `typecheck`, `build` e suíte E2E.

---

## 7. Pontos para Decisão Antes da Fase CS-1

1. **Localização do código**: criar um pacote dedicado `packages/creative-studio` (`@neuralbridge/creative-studio`) ou um submódulo dentro de `packages/cinema`? *(Recomendado: `packages/creative-studio` consumindo utilitários de `@neuralbridge/cinema` para manter fronteiras limpas.)*
2. **Dependência `sharp`**: confirmar a adição de `sharp` no workspace para manipulação de imagens de alta performance em Node.js (com fallback via `ffmpeg` se binário nativo estiver indisponível).
3. **Aprovação para iniciar a Fase CS-1**: após confirmar os dois pontos acima, iniciamos a implementação pela Fase CS-1.
