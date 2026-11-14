# Fase 46 — Velix Motion: do roteiro ao vídeo

**Status:** PLANEJADA (2026-11-03). Só planejamento: sem implementação, dependências novas ou commit.

## 1. Objetivo

Hoje a aba Motion monta o vídeo cena por cena. A meta é transformar o roteiro aprovado em um vídeo motion completo, que o usuário revisa e ajusta, sem montar tudo à mão:

1. gerar as cenas automaticamente a partir do roteiro aprovado, cada uma ligada ao trecho que ilustra;
2. trocar o tipo de qualquer cena gerada sem perder o texto;
3. gerar a narração na própria aba Motion (VoiceStudio local ou ElevenLabs manual);
4. sincronizar a duração das cenas e as legendas com a voz gerada;
5. definir o fundo do vídeo e de cada cena;
6. adicionar fotos e escolher fontes.

O Motion continua sendo um adaptador da Fase 39, não um segundo motor. Nada é publicado automaticamente, e a sugestão do agente continua sendo aplicada por uma ação humana.

## 2. Ponto de partida (auditoria de 2026-11-03)

| Área | Estado atual | Lacuna |
|---|---|---|
| Contrato | `packages/shared/src/motion.ts`: `schemaVersion: 1`, 5 tipos de cena (`title`, `card`, `stat`, `lower-third`, `bars`), transição `cut`/`fade` | Sem fundo, foto, fonte, vínculo com o roteiro ou referência de narração |
| Sugestão | `packages/orchestrator/src/video-motion.ts` via `TaskEngine.runStructuredReadOnly`; `MOTION_SUGGESTION_SCHEMA` só aceita `title` e `card` | Sem número, gráfico, crédito ou foto, e sem trecho do roteiro por cena |
| Edição | `VelixMotion.tsx`: editar campos, remover cena, adicionar no fim | Sem trocar tipo, reordenar, regenerar uma cena; duração em quadros, não em segundos |
| Narração | VoiceStudio só no Estúdio (`VelixStudio.tsx` → `velix-narration.ts`, sidecar com `NarrationAsset`) | No Motion, o áudio é um caminho digitado à mão; um caminho absoluto falha |
| Sincronia | `alignVelixMotionVoice` alinha só **legendas** já importadas | Cenas não ganham duração pela fala; legendas não são geradas do roteiro |
| Visual | `MotionComposition.tsx`: fundo `#000`, fonte única, tokens fixos | Sem fundo customizado, imagens ou fontes |
| Prévia | Player do Remotion sem áudio | Não dá para conferir a sincronia antes do render |
| Persistência | `velix_motion_projects.data` (JSON, migração 0050) | O JSON comporta v2 sem migração de tabela |

## 3. Decisões que dependem do usuário (pontos de aprovação)

Responder antes de 46.1:

1. **Fontes:** (a) só um conjunto empacotado com licença OFL (Inter, IBM Plex Sans/Mono, que já estão nas dependências, e mais 3 ou 4 a escolher); ou (b) também importar `.ttf`/`.otf` local com confirmação de licença. Recomendação: (a) primeiro e (b) depois, como opção.
2. **Fotos:** (a) só arquivos locais do projeto e assets autorizados pela Discovery/Rights Manager (Fase 36); ou (b) também busca em bancos de imagem. Recomendação: (a). (b) exige provider, chave e revisão de licença próprios.
3. **Fundo em vídeo:** entra nesta fase (loop mudo autorizado) ou fica para depois? Recomendação: cor, gradiente e imagem nesta fase; vídeo em loop como extra em 46.5, se o render se mantiver estável.
4. **Formato vertical 9:16:** entra nesta fase ou fica para depois? Recomendação: só 16:9 nesta fase.

## 4. Contrato v2 (proposta)

```ts
type MotionProjectV2 = MotionProject & {
  schemaVersion: 2;
  style: { background: MotionBackground; font: MotionFontId; accent: string /* hex validado */ };
  narration?: { assetId: string; relativePath: string } | null; // NarrationAsset do sidecar
};
type MotionBackground =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; from: string; to: string; angle: number }
  | { kind: 'image'; assetRef: AuthorizedAssetRef; dim: number /* 0–0.8, garante contraste */ }
  | { kind: 'video'; assetRef: AuthorizedAssetRef; dim: number }; // depende da decisão 3
// Toda cena ganha campos opcionais:
//   segment?: { text: string; startChar: number; endChar: number }   trecho do roteiro
//   background?: MotionBackground                                    sobrepõe o do projeto
//   lockedDuration?: boolean                                         a sincronia não altera
// Novo tipo de cena:
//   { kind: 'photo'; assetRef; caption?; motion: 'none' | 'zoom-in' | 'pan' }
```

- **Compatibilidade:** v1 continua abrindo e renderizando. `upgradeMotionProject(v1)` converte em memória (fundo `solid #000`, fonte padrão), e o v1 salvo só vira v2 quando o usuário salva.
- **Assets:** `AuthorizedAssetRef` é um caminho relativo dentro da raiz do projeto, mais hash e estado de direitos. O main resolve com `realpath` confinado à raiz. Imagem sem direito verificado bloqueia o render, como já acontece com mídia na Fase 36.
- **Fontes:** `MotionFontId` é um enum da lista permitida, nunca um nome livre ou URL.
- **Troca de tipo:** `convertMotionScene(scene, kind)` é uma função pura que leva o texto principal e o trecho do roteiro para o novo tipo e preenche os campos obrigatórios que faltam com marcadores visíveis. Um número sem fonte continua bloqueado pelo contrato.

## 5. Subfases

Ordem: 46.1 → 46.8. Cada subfase só vira CONCLUÍDA com testes e evidência real.

### 46.1 — Contrato v2, troca de tipo e reordenação
- **Escopo:** schemas v2 em `motion.ts`, `upgradeMotionProject`, `convertMotionScene`, validação no main (`validateMotionProject`) e IPC aceitando v1 e v2. Na UI: seletor "Tipo" em cada cena, mover cena para cima/baixo e duração em segundos (os quadros ficam internos).
- **Testes:** unidade para upgrade, conversão entre os 6 tipos, limites e caminho fora da raiz; E2E: trocar Título → Cartão sem perder texto e abrir um projeto v1 salvo.
- **Aceite:** projeto v1 existente abre, edita e renderiza igual a antes.

### 46.2 — Roteiro → composição automática
- **Escopo:** `MOTION_SUGGESTION_SCHEMA` cobre todos os tipos e devolve `segment` por cena. O prompt pede números e gráficos só com fonte presente no roteiro, e o parser rejeita uma estatística sem fonte. O botão "Gerar motions do roteiro" substitui "Sugerir composição"; a revisão mostra cena, tipo e trecho, com aplicar tudo, aplicar uma ou descartar. "Regenerar esta cena" pede alternativas só para aquele trecho.
- **Segurança:** roteiro e saída do agente são dados não confiáveis; tudo continua read-only no TaskEngine e respeita a trava de quota do Claude.
- **Testes:** fixtures com roteiro malicioso, número sem fonte, provider indisponível e cancelamento; E2E com provider fake; uma rodada real com Claude e com Codex.
- **Aceite:** roteiro aprovado → cenas cobrindo o roteiro inteiro, sem trecho repetido nem pulado.

### 46.3 — Narração dentro da aba Motion
- **Escopo:** extrair `VoiceStudioNarration` de `VelixStudio.tsx` para um componente compartilhado e usá-lo no Motion, gerando a partir do texto do roteiro aprovado. O ElevenLabs manual continua disponível. O campo de caminho livre vira um seletor dos `NarrationAsset` do sidecar, com caminho relativo garantido. A prévia do Player toca a narração escolhida.
- **Testes:** componente com status disponível/indisponível/incompatível; E2E com VoiceStudio fake; homologação real com a voz do usuário.
- **Aceite:** gerar, ouvir e escolher a narração sem sair da aba Motion.

### 46.4 — Sincronizar cenas e legendas com a voz
- **Escopo:** reaproveitar a transcrição de `alignVelixMotionVoice`. (a) Cada cena com `segment` recebe início e fim a partir das palavras faladas daquele trecho, e as cenas com `lockedDuration` não mudam. (b) "Gerar legendas da narração" cria legendas do roteiro com tempos da voz, sem exigir SRT colado. O SRT e o ajuste em ms continuam como opção manual.
- **Regras:** um trecho não encontrado mantém a duração e é listado para revisão, nunca chutado. Cenas sem `segment` dividem o tempo restante.
- **Testes:** unidade com palavras sintéticas (nome separado, palavra mal ouvida, trecho ausente); integração com a transcrição real; E2E verificando que a soma das cenas é igual à duração do áudio, com tolerância de 1 quadro.
- **Aceite:** no MP4, cada cena entra quando a voz começa o seu trecho (conferido por FFprobe e por inspeção de quadros).

### 46.5 — Fundo do vídeo
- **Escopo:** painel "Estilo" com fundo do projeto (cor, gradiente, imagem e, conforme a decisão 3, vídeo) e sobreposição por cena. O escurecimento garante contraste mínimo do texto. O renderizador recebe os assets por caminho confinado, e o Player usa a mesma resolução de assets.
- **Testes:** snapshots dos 4 fundos, contraste AA do texto sobre imagem escurecida e render real com imagem de fundo.
- **Aceite:** prévia e MP4 iguais e asset sem direito bloqueado.

### 46.6 — Fotos e fontes
- **Escopo:** cena `photo` (imagem, legenda opcional, zoom/pan suave e movimento reduzido respeitado), escolha de foto a partir dos assets do projeto ou importação de arquivo local com registro de direitos, e fonte do projeto a partir da lista permitida, com fontes empacotadas no bundle Motion. A importação de fonte local depende da decisão 1.
- **Testes:** imagem grande/pequena/corrompida, extensão falsa, caminho com acentos e espaços, fonte ausente no render (falha clara, sem fallback silencioso).
- **Aceite:** foto e fonte aparecem iguais na prévia e no MP4, com licenças registradas no manifesto do render.

### 46.7 — Experiência de edição
- **Escopo:** lista de cenas como linha do tempo (miniatura, tipo, trecho e duração), clique leva a prévia ao início da cena, estados de carregamento, erro e vazio, e teclado. Seguir `MASTER.md` e a identidade preta e laranja.
- **Testes:** acessibilidade (axe), larguras 960/1024/1440, movimento reduzido e matriz visual.

### 46.8 — Homologação e release
- **Escopo:** jornada real ponta a ponta: roteiro aprovado → gerar motions → trocar 2 tipos → gerar narração VoiceStudio → sincronizar → fundo com imagem → foto → render → FFprobe. Gates globais e instalador com versão patch inédita.
- **Aceite:** MP4 com áudio, duração igual à da narração, cenas sincronizadas e projeto reaberto após reiniciar o app.

## 6. Riscos

| Risco | Mitigação |
|---|---|
| Agente inventa números | Parser exige fonte presente no roteiro; sem fonte, a cena vira cartão |
| Asset fora da raiz ou sem direito | `realpath` confinado, hash e gate de direitos no render |
| Render pesado com imagens/vídeo | Limite de tamanho por asset e redimensionamento antes do render; 1 render por projeto |
| Sincronia errada | Trechos não achados ficam para revisão; `lockedDuration` protege edição manual |
| Quebra de projetos v1 | Upgrade em memória, testes com fixtures v1 salvas |
| Licença de fontes/imagens | Lista permitida OFL e manifesto de licenças no render |
| Licença Remotion | Segue como bloqueio externo da 39.8; esta fase não altera a decisão |

## 7. Primeiro lote

> Leia `docs/PLAN.md`, `docs/STATUS.md`, este plano e `phase-39-velix-motion-engine.md`. Com as decisões da seção 3 respondidas, implemente só a 46.1: contrato v2 em `packages/shared/src/motion.ts` com `upgradeMotionProject` e `convertMotionScene`, validação no main, seletor de tipo, reordenação e duração em segundos em `VelixMotion.tsx`. Preserve projetos v1, não instale dependências e não faça commit. Rode os testes de `motion`, typecheck e o E2E `velix-motion.spec.ts`, e registre a evidência em PLAN e STATUS.
