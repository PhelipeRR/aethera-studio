# Fase 44 — Motion Design do Companion HUD: plano de implementação

> **Para agentes:** execute tarefa a tarefa, com `superpowers:subagent-driven-development` ou `superpowers:executing-plans`. Os passos usam checkbox (`- [ ]`). Pelo `AGENTS.md`, nenhuma etapa cria commit automaticamente: o commit só acontece a pedido do usuário.

**Objetivo:** fazer mascote, cápsula e painel se comportarem como um único objeto físico, com molas interrompíveis, sem teleporte, corte ou piscada, e mascote que reflete só estados reais.

**Arquitetura:** a janela deixa de mudar de tamanho a cada modo. Ela vira um palco fixo de 820×440, transparente e click-through, e toda a transformação acontece dentro dela, em um único alvo por modo. Uma superfície sem filhos anima tamanho e raio, e o conteúdo é renderizado no tamanho final, entrando e saindo por opacidade e transform.

**Stack:** Electron 44, React 19, `motion` 14.9.0 (`motion/react`, dependência nova e restrita a esta feature), CSS transitions com tokens para microinterações, Vitest e Playwright Electron.

**Spec:** pedido do usuário de 2026-11-02, reproduzido nos critérios desta fase; resumo e status em `docs/PLAN.md`, Fase 44.

> **Execução (2026-11-02):** o que mudou em relação a este plano. A compensação FLIP ao soltar foi medida e rejeitada (saltos de 280 a 957 px): o palco acompanha a âncora durante o arraste, e o processo principal acomoda os últimos pixels. A decisão "Persistência" não se manteve: `companionHud.align` foi acrescentado, aditivo e com padrão, para a cápsula não saltar e o painel não inverter ao soltar. O teste de fala real expôs um bug anterior: o CSP bloqueava áudio `data:`, e a voz do VoiceStudio nunca tocava; `media-src 'self' data:` corrige isso. Resultados em `docs/STATUS.md`.

## Diagnóstico das causas

Auditoria do código em `feat/neura-assistant` (6320bb3), sem medição em tela ainda; a Tarefa 1 confirma cada item.

| # | Causa | Evidência | Efeito visível |
|---|---|---|---|
| 1 | **O mascote teleporta.** `boundsForMode` empurra o modo para dentro do monitor e `setBounds` move a origem da janela de uma vez. O mascote está preso ao canto superior esquerdo da janela. | `companion-hud-layout.ts:60`, `companion-hud-window.ts:64` | Na âncora padrão (canto inferior direito), o mascote salta cerca de 300 px ao abrir a cápsula e 660 × 290 px ao abrir o painel. É a causa dominante, e nenhum ajuste de CSS a resolve. |
| 2 | **Resize e React não são atômicos.** Ao crescer, a janela muda, e só depois do retorno do IPC o estado muda. | `CompanionHud.tsx:142-150` | Um ou mais quadros com o shell antigo na janela nova. |
| 3 | **Conteúdo sem saída.** Cápsula e painel são `mode === … &&`: desmontam no mesmo quadro. | `CompanionHud.tsx:164-165` | Ao recolher, o conteúdo some antes do shell começar a encolher. |
| 4 | **Sem física.** Transição CSS de 220 ms em `width/height/left/top`, com um `SHRINK_MS` de 240 ms decorado para sincronizar. | `styles.css:193,199`, `CompanionHud.tsx:17` | Movimento uniforme, relayout a cada quadro, e sem velocidade preservada em interrupção. |
| 5 | **O mascote troca de rosto por substituição.** `Face` faz `switch` e troca o SVG sem transição. Reações usam keyframes repetidos, e a piscada é um ciclo fixo de 5,5 s só em `idle`. | `NeuralBridgeMascot.tsx:11-25`, `styles.css:213-219` | Expressões trocam a seco, e o movimento parece mecânico. |
| 6 | **Soltar o arraste salta.** `handleDrag('end')` aplica o snap com `setBounds` direto. | `companion-hud-window.ts:134-136` | Salto de até 16 px. |
| 7 | **Spotify sem transição.** Capa e textos trocam na hora, a barra anima `width` a cada segundo e `key={playback.volume}` remonta o slider a cada mudança de volume. | `SpotifyPlayer.tsx:27-37` | Trocas secas, e o slider pode perder o gesto durante um poll. |
| 8 | **Configurações pisca.** `openMainRoute` mostra a janela antes de trocar a hash. | `apps/desktop/src/main/index.ts:78-85` | A rota anterior aparece por um instante. |
| 9 | **Lacunas de estado.** Não existe sinal de fala observável, e `listening` significa música, mas `neuraMascot` o usa para voz (o rótulo diz "ouvindo música"). | `companion-state.ts:15`, `neura-state.ts:29`, `useNeura.ts:20` | O mascote não fala e descreve a voz de forma errada. |

## Decisões

| Decisão | Escolha | Motivo e alternativa rejeitada |
|---|---|---|
| Janela | **Palco fixo** do tamanho do painel. A janela só muda em arraste, troca de monitor e reset. | `setBounds` passo a passo no main sofre latência de IPC e repaint de janela transparente. A técnica FLIP com janela justa mantém um quadro de teleporte sempre que a origem muda. O palco elimina a corrida em vez de escondê-la. **Fallback do gate da Tarefa 1:** janela justa + FLIP. |
| Lado de crescimento | Espelhamento **horizontal** quando o mascote fica na metade direita do palco (`side: 'right'`). Na vertical, o mascote desliza até o cabeçalho. | Sem espelhar, ele cruzaria quase 700 px na âncora padrão. Espelhar a vertical exigiria outro layout de painel. Muda o layout visível: **precisa de aprovação**. |
| Biblioteca | `motion` fixado em 14.9.0, com `LazyMotion` e `domAnimation`, só em `features/companion`. | O desktop não tem biblioteca de animação. Mola com velocidade preservada, somada a `AnimatePresence` para saída, justificaria uma mini biblioteca própria. **Precisa de aprovação** por ser dependência nova. |
| Persistência | `companionHud.x/y` continua sendo o canto superior esquerdo da área do mascote. | Sem migração de preferências: posições salvas seguem válidas. |
| Estados pedidos ↔ reais | `idle`→`idle`, `listening`→**`voiceListening`** (novo), `thinking`→`thinking`, `speaking`→**`speaking`** (novo), `happy`→`success`, `error`→`error`, `sleeping`→`resting`, `working`→`running`. `waiting`, `degraded`, `disconnected`, `listening` (música) e `musicPaused` permanecem. | Nada é inventado: `speaking` vem do áudio real, e não há timer de "dormir por inatividade". |
| Sincronia com áudio | Amplitude real via `AnalyserNode` no áudio do VoiceStudio. No fallback `speechSynthesis`, pulso por `onboundary`. | O fallback não expõe áudio, então a boca segue as palavras, não a amplitude. É uma limitação a declarar na entrega. |

## Parâmetros de movimento

Fonte única: `apps/desktop/src/renderer/src/features/companion/companion-motion.ts`. Valores iniciais, ajustáveis em revisão visual.

| Token | Valor | Uso |
|---|---|---|
| `HUD_SPRING.expand` | stiffness 260, damping 28, mass 1 | shell e mascote ao crescer (acomoda em cerca de 300 ms, ζ ≈ 0,87) |
| `HUD_SPRING.collapse` | stiffness 300, damping 32, mass 1 | shell e mascote ao recolher (ζ ≈ 0,92) |
| `HUD_SPRING.impulse` | stiffness 420, damping 18, mass 0,8 | impulso de notificação, amplitude máxima de 6 px |
| `HUD_MS.hover` | 180 | hover |
| `HUD_MS.micro` | 150 | press, ícones, toggles |
| `HUD_MS.content` | 220 | entrada de conteúdo, deslocamento de 6 px |
| `HUD_MS.session` | 280 | troca de sessão, deslocamento de 12 px |
| `HUD_MS.face` | 140 | crossfade de expressão |

## Restrições globais

- Preservar IPC, integrações e sessões; mudanças de contrato são só aditivas. Nenhuma alteração em TaskEngine, Session Registry ou Permission Broker.
- O mascote reflete só estados reais. Spotify usa só dados reais.
- `transition: all` é proibido. Animar apenas `transform`, `opacity`, e `width/height/border-radius` somente na superfície sem filhos.
- `prefers-reduced-motion`: sem mola nem deslocamento; apenas troca direta ou fade de até 80 ms, e nenhum loop.
- HUD oculto ou suspenso não executa timers de vida nem loops.
- Foco e `focusable` em modos não expandidos seguem como estão: clicar no mascote não rouba foco.
- Sem desativar testes. Em falha com `git` em paralelo, confirmar com `npx vitest run --no-file-parallelism`.

## Foco de revisão

Situações que a spec implica e que precisam de teste próprio:

1. **Monitor removido ou DPI alterado durante uma mola:** a janela vai para o novo palco e o mascote fica dentro do monitor, sem estado preso. Teste na Tarefa 2.
2. **Clique durante a saída:** conteúdo saindo não captura clique nem teclado, e a área já vazia repassa o mouse ao app de baixo. Teste na Tarefa 4.
3. **Foco no painel que recolhe:** com o foco em um botão do painel, `Esc` recolhe sem deixar foco em elemento inerte. Teste na Tarefa 4.
4. **Ocultar, fechar (Alt+F4) ou reabrir no meio da transição:** a janela recriada abre direto no modo salvo, sem animar a partir de valores antigos. Teste na Tarefa 4.
5. **`state` pendente sobrescrevendo clique:** um `getHudState` que retorna depois do clique não reverte o modo. Teste na Tarefa 4.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `packages/shared/src/companion.ts` | adiciona `layout` a `companionHudStateSchema` |
| `apps/desktop/src/main/companion-hud-layout.ts` | `hudStage`, cálculo puro do palco |
| `apps/desktop/src/main/companion-hud-window.ts` | janela de tamanho fixo, arraste do palco |
| `features/companion/companion-motion.ts` (novo) | tokens, `hudTargets`, `dragTilt`, `speechLevel` |
| `features/companion/CompanionHud.tsx` | modo único, `MotionConfig`, presença de conteúdo |
| `features/companion/useHudPointer.ts` | velocidade de arraste para a elasticidade |
| `features/companion/NeuralBridgeMascot.tsx` | camadas e crossfade de expressão |
| `features/companion/useMascotLife.ts` (novo) | piscadas e olhares agendados |
| `features/companion/companion-state.ts` | novos estados, `resolveMascotState` |
| `features/neura/useNeura.ts` | sinal real de fala |
| `features/companion/SpotifyPlayer.tsx` | crossfade, progresso em componente isolado |
| `apps/desktop/src/renderer/src/styles.css` | remove `transition` de layout do HUD, tokens e microinterações |
| `apps/desktop/src/main/index.ts` | `openMainRoute` sem piscar |

---

### Tarefa 1: Baseline e gate do palco fixo

Medir antes de mudar. Nenhum código de produção é alterado; o protótipo fica fora do repositório, no scratchpad.

**Arquivos:**
- Criar: `tests/e2e/companion-motion-probe.ts` (mede posição de tela do mascote por quadro)

**Interfaces:**
- Produz: `sampleMascotPath(page: Page, durationMs: number): Promise<{ t: number; x: number; y: number }[]>`, em que `x/y` somam `window.screenX/Y` ao `getBoundingClientRect` de `.companion-mascot`, por `requestAnimationFrame`.

- [ ] **Passo 1: Gravar o baseline.** Com a build atual, gravar com `C:\ffmpeg\bin\ffmpeg -f gdigrab -framerate 60` as sequências mascote → cápsula → painel → cápsula → mascote, na âncora padrão e em (200, 200), a 100% e 150% de DPI. Salvar em `test-results/motion-baseline/`, que serve de "antes" na entrega.
- [ ] **Passo 2: Registrar números.** Salto máximo do mascote por quadro, CPU do renderer do HUD parado por 60 s em `idle` e `running`, e bundle gzip do renderer.
- [ ] **Passo 3: Prototipar o palco.** Em cópia local, fixar a janela em 820×440 e validar: repasse de clique e hover para o app de baixo nas margens, toggle de `WS_EX_TRANSPARENT`, sem artefato de transparência, always-on-top após troca de foco, custo de CPU e GPU parado e arraste em dois monitores.
- [ ] **Passo 4: Decidir o gate.** Aprovado se tudo do Passo 3 passar e a CPU parada não subir mais que 0,5 ponto percentual. Se reprovar, parar e levar ao usuário o fallback (janela justa + FLIP), que altera as Tarefas 2 e 4.

Saída: resultado do gate registrado em `docs/STATUS.md`.

### Tarefa 2: Palco fixo no processo principal

**Arquivos:**
- Modificar: `packages/shared/src/companion.ts:154`
- Modificar: `apps/desktop/src/main/companion-hud-layout.ts`, `apps/desktop/src/main/companion-hud-window.ts`
- Testar: `apps/desktop/test/companion-hud-layout.test.ts`, `apps/desktop/test/companion-ipc.test.ts`, `packages/shared/test/companion.test.ts`, `tests/e2e/companion-hud.spec.ts`

**Interfaces:**
- Produz, em `@neuralbridge/shared/companion`: `companionHudLayoutSchema = z.strictObject({ origin: point, mascot: point, compact: point, side: z.enum(['left', 'right']) })`, `type CompanionHudLayout`, e `CompanionHudState.layout`. `origin` é a posição do palco na tela; `mascot` e `compact` são relativos a ele.
- Produz, no main: `hudStage(anchor: Point | null, areas: readonly Rect[], primary: Rect): { bounds: Rect; layout: Omit<CompanionHudLayout, 'origin'> }`.

- [ ] **Passo 1: Escrever os testes do layout.**

```ts
it('keeps the stage fixed and places the mascot inside it at the default anchor', () => {
  const { bounds, layout } = hudStage({ x: 1764, y: 892 }, areas, primary);
  expect(bounds).toEqual({ x: 1100, y: 600, width: 820, height: 440 });
  expect(layout).toEqual({ mascot: { x: 664, y: 292 }, compact: { x: 366, y: 292 }, side: 'right' });
});
it('grows to the right on a roomy monitor', () => {
  expect(hudStage({ x: 200, y: 200 }, areas, primary).layout).toEqual({ mascot: { x: 0, y: 0 }, compact: { x: 0, y: 0 }, side: 'left' });
});
it('keeps the mascot on screen when its monitor is gone', () => {
  const { bounds, layout } = hudStage({ x: -600, y: 300 }, [primary], primary);
  expect(bounds.x + layout.mascot.x).toBeGreaterThanOrEqual(0);
});
```

Também: âncora em monitor com coordenadas negativas, `compact` sempre dentro do palco e área de trabalho menor que o palco. Na E2E, emitir `display-metrics-changed` durante uma mola e verificar que o `layout` publicado e o mascote terminam dentro do monitor.

- [ ] **Passo 2:** `npx vitest run apps/desktop/test/companion-hud-layout.test.ts`. Esperado: FALHA, `hudStage` inexistente.
- [ ] **Passo 3: Implementar `hudStage`.** `bounds = boundsForMode(anchor, 'expanded', …)`. `mascot` é a âncora limitada com `clampToArea` ao monitor, menos `bounds`. `side` é `'right'` quando `mascot.x > (820 - 132) / 2`. `compact.x` é `mascot.x + 132 - 430` à direita, ou `mascot.x` à esquerda, limitado a `[0, 820 - 430]`; `compact.y = mascot.y`.
- [ ] **Passo 4: Adaptar o controller.** `create` e `applyBounds` usam só `hudStage(...).bounds`; `setMode` altera preferência e `setFocusable`, sem `setBounds`. `state()` inclui `layout`, e `?layout=` entra na URL junto de `mode`, para o primeiro quadro já sair correto. `publish()` roda depois de `applyBounds` e de `display-*`.
- [ ] **Passo 5: Arraste.** Durante o arraste, o palco acompanha o cursor rigidamente, com deslocamento congelado, mesmo parcialmente fora do monitor. Em `end`: âncora = posição do palco + `layout.mascot`; aplicar `snapToArea` sobre o retângulo visível do modo; salvar a âncora; `setBounds` do novo palco; `publish()`.
- [ ] **Passo 6: Atualizar E2E de `hudBounds`.** As asserções de tamanho por modo (`companion-hud.spec.ts:104,109,268,272,304,323,327,335`) passam a verificar palco constante e posição de tela do mascote igual à âncora. Margens de `companion-real-mouse.spec.ts` e `:296-299` passam a usar o retângulo do mascote.
- [ ] **Passo 7:** `npx vitest run apps/desktop/test packages/shared/test/companion.test.ts` passa; `npm run build; npx playwright test tests/e2e/companion-hud.spec.ts tests/e2e/companion-real-mouse.spec.ts` passa, exceto os casos que dependem do renderer da Tarefa 4, listados de forma explícita.

### Tarefa 3: Linguagem de movimento

**Arquivos:**
- Modificar: `apps/desktop/package.json`, lockfile
- Criar: `apps/desktop/src/renderer/src/features/companion/companion-motion.ts`
- Testar: `apps/desktop/test/companion-motion.test.ts`

**Interfaces:**
- Produz: `HUD_SPRING`, `HUD_MS` (tabela acima); `interface HudTargets { shell: { x: number; y: number; width: number; height: number; radius: number; surface: number }; mascot: { x: number; y: number; scale: number } }`; `hudTargets(layout: CompanionHudLayout, mode: CompanionHudMode): HudTargets`; `hudTransition(from: CompanionHudMode, to: CompanionHudMode, reduced: boolean): Transition`.

- [ ] **Passo 1: Escrever os testes de `hudTargets`,** mantendo a geometria de hoje com o mascote na esquerda:

```ts
const left = { origin: { x: 0, y: 0 }, mascot: { x: 0, y: 0 }, compact: { x: 0, y: 0 }, side: 'left' } as const;
expect(hudTargets(left, 'mascot')).toEqual({ shell: { x: 10, y: 10, width: 112, height: 104, radius: 52, surface: 0 }, mascot: { x: 14, y: 12, scale: 1 } });
expect(hudTargets(left, 'compact').shell).toEqual({ x: 12, y: 24, width: 406, height: 80, radius: 40, surface: 1 });
expect(hudTargets(left, 'expanded').shell).toEqual({ x: 12, y: 12, width: 796, height: 416, radius: 26, surface: 1 });
expect(hudTargets(left, 'expanded').mascot).toMatchObject({ x: 28, y: 22 });
```

Para `side: 'right'`, com `compact.x = 366`: mascote da cápsula em `x = 366 + 430 - 18 - 104 = 674`, e do painel em `x = 820 - 28 - 84 = 708`. Com `reduced`, `hudTransition` retorna `{ duration: 0 }`; ao crescer usa `expand`, ao recolher usa `collapse`.

- [ ] **Passo 2:** `npx vitest run apps/desktop/test/companion-motion.test.ts`. Esperado: FALHA.
- [ ] **Passo 3:** `npm install motion@14.9.0 --save-exact -w @neuralbridge/desktop` e implementar o módulo. Escala do mascote no painel: `84 / 104`.
- [ ] **Passo 4:** testes passam; `npm run build` passa. Registrar o aumento do bundle gzip: acima de 35 KB, importar `CompanionHud` de forma dinâmica em `main.tsx:32`, para a janela principal não carregar `motion`.

### Tarefa 4: Forma única, expansão e contração

**Arquivos:**
- Modificar: `features/companion/CompanionHud.tsx`, `apps/desktop/src/renderer/src/styles.css:193-203,244,269`
- Testar: criar `tests/e2e/companion-motion.spec.ts`

**Interfaces:**
- Consome: `hudTargets`, `hudTransition`, `CompanionHudState.layout`, `sampleMascotPath`.
- Estrutura: `.companion-surface` (sem filhos, anima `width/height/borderRadius` e `transform`) e `.companion-content` (`contain: layout paint`, recorta com `overflow: hidden`, filhos no tamanho final), ambas em `.companion-shell`; `.companion-mascot` anima `x/y/scale` com `transform-origin: 0 0`.

- [ ] **Passo 1: Escrever a E2E.** Testes:
  - `keeps the mascot continuous from mascot to panel at the default anchor`: nenhum salto entre quadros acima de 60 px, e ponto final igual a `hudTargets`.
  - `returns the mascot to the exact anchor after collapsing`: diferença de 0 px.
  - `ends in the last requested mode after rapid clicks`: 10 cliques com 40 ms de intervalo, sem exceção e com formato e preferência coerentes.
  - `switches session while the panel expands`: sessão escolhida fica selecionada.
  - `lets clicks through while content exits`: o conteúdo saindo tem `inert`, sem `data-hud-hit`.
  - `leaves no focus on an inert element after Esc`.
  - `reopens in the saved mode without animating from stale values`: Alt+F4 durante a mola.
  - `ignores a late getHudState after a click`: resposta atrasada não reverte o modo.
  - `does not animate with reduced motion`: emulação; primeiro quadro após o clique já no alvo.
- [ ] **Passo 2:** `npm run build; npx playwright test tests/e2e/companion-motion.spec.ts`. Esperado: FALHA.
- [ ] **Passo 3: Simplificar `setMode`.** Um único `setModeState(next)` síncrono, com `setHudMode(next)` só para persistir. Remover `SHRINK_MS`, `MODE_ORDER`, `shrinkTimer` e `reducedMotion()`.
- [ ] **Passo 4: Estado externo não reverte clique.** `apply` só altera `mode` em eventos `onHudState` vindos do main. A carga inicial de `getHudState` não sobrescreve depois de uma interação do usuário.
- [ ] **Passo 5: Motion.** Envolver em `LazyMotion features={domAnimation}` e `MotionConfig reducedMotion="user"`. `initial={false}` no primeiro render. Shell e mascote animam para `hudTargets(layout, mode)` com `hudTransition`.
- [ ] **Passo 6: Coreografia.**
  - Ao expandir: superfície e mascote partem juntos; o conteúdo entra aos 60 ms, com stagger de 30 ms entre cabeçalho e colunas, opacidade e `y: 6`.
  - Ao recolher: conteúdo sai em 100 ms, e a mola parte 40 ms depois. Em interrupção, sem atraso e com velocidade preservada.
  - `AnimatePresence initial={false}` envolve cápsula e painel. Quem sai recebe `inert` e `aria-hidden`, sem `data-hud-hit`.
- [ ] **Passo 7: Espelhamento.** `data-hud-side` no `main`. No lado direito: `.companion-capsule` com `flex-direction: row-reverse` e padding invertido, e `.companion-panel__header` com `row-reverse` e `padding-right: 100px`. O corpo do painel não muda.
- [ ] **Passo 8: Limpar CSS.** Remover `transition` de `width/height/top/left` em `.companion-shell` e `.companion-mascot` e as regras de `.companion-reveal`. Hit-test no modo mascote continua só em `.companion-mascot`.
- [ ] **Passo 9:** E2E de movimento e `companion-hud.spec.ts` passam, incluindo as pendências listadas na Tarefa 2; `neura-hud.spec.ts` e `companion-spotify.spec.ts` passam.

### Tarefa 5: Arraste com elasticidade

**Arquivos:**
- Modificar: `features/companion/useHudPointer.ts`, `features/companion/CompanionHud.tsx`, `companion-motion.ts`
- Testar: `apps/desktop/test/companion-motion.test.ts`, `tests/e2e/companion-motion.spec.ts`

**Interfaces:**
- Produz: `dragTilt(velocityX: number): number`, com retorno em graus, limitado a ±3; `useHudDrag` passa a devolver também `tilt: MotionValue<number>`.

- [ ] **Passo 1: Testes.** `dragTilt(0) === 0`; `dragTilt(5000) === 3`; `dragTilt(-5000) === -3`. E2E `settles the snap without a jump`: soltar a 9 px da borda; sem salto acima de 16 px, e `companionHud.x` salvo igual ao snap.
- [ ] **Passo 2:** verificar a falha.
- [ ] **Passo 3: Implementar.** Janela acompanha o cursor 1:1, sem atraso. A velocidade de `screenX` entre eventos alimenta `tilt`, aplicado com `useSpring` só no mascote, voltando a 0 no fim. Em reduced motion, sem `tilt`.
- [ ] **Passo 4: Soltura.** Ao receber `layout` novo, calcular a posição anterior de tela (`origem + mascote`) e continuar a mola dali até o novo alvo. A ordem entre `setBounds` e `publish` segue a medição da Tarefa 1.
- [ ] **Passo 5:** testes e `drags, snaps and restores the position after a restart` passam.

### Tarefa 6: Mascote vivo

**Arquivos:**
- Modificar: `features/companion/NeuralBridgeMascot.tsx`, `features/companion/companion-state.ts`, `features/neura/neura-state.ts:29`, `features/companion/CompanionHud.tsx:126`, `styles.css:205-240`
- Criar: `features/companion/useMascotLife.ts`
- Testar: `apps/desktop/test/companion-mascot.test.ts`, `apps/desktop/test/companion-motion.test.ts`

**Interfaces:**
- Produz: `MascotState` com `'speaking' | 'voiceListening'`; `resolveMascotState(input: { available: boolean; speaking: boolean; reaction: MascotReaction | null; neura: MascotState | null; session: MascotState; playback: { isPlaying: boolean } | null }): MascotState`; `nextBlinkDelay(random: number): number`; `useMascotLife(ref: React.RefObject<SVGSVGElement | null>, state: MascotState, active: boolean): void`.

- [ ] **Passo 1: Testes.** Ordem: `disconnected` > `speaking` > reação > Neura > sessão > música. `neuraMascot` com voz ativa retorna `voiceListening`, e `MASCOT_LABELS.voiceListening` é "ouvindo você". `nextBlinkDelay(0) === 2400`; `nextBlinkDelay(1) === 7000`.
- [ ] **Passo 2:** verificar a falha.
- [ ] **Passo 3: Camadas.** Corpo e cabeça permanecem montados. `Face` e `Accent` entram em `AnimatePresence initial={false}`, com crossfade de `HUD_MS.face`. Mantém `key` por `beat` e `data-mascot-state`. Nenhuma forma, cor ou gradiente muda.
- [ ] **Passo 4: Vida.**
  - `useMascotLife` agenda piscadas com `nextBlinkDelay` e 12% de chance de piscada dupla, por WAAPI, nos estados com olhos abertos.
  - Em `thinking`, olhar lento com translação de até 2 px e pausas de 0,8–2,2 s.
  - `voiceListening`: olhos atentos e pulso de 2 s em opacidade.
  - `resting`: respiração em 6 s e sem acento contínuo.
  - Com `active === false` ou reduced motion, nenhum timer fica agendado.
- [ ] **Passo 5: Reações.** Trocar `nb-hop` (3×) e `nb-shake` (5×) por um impulso único com `HUD_SPRING.impulse`, de até 6 px. A expressão continua durando `REACTION_MS`.
- [ ] **Passo 6: Custo.** Se a CPU parada ultrapassar baseline + 0,5 ponto, trocar `filter: drop-shadow` em `.nb-mascot svg` por sombra estática no SVG. Revalidar visualmente.
- [ ] **Passo 7:** `npx vitest run apps/desktop/test/companion-mascot.test.ts apps/desktop/test/companion-motion.test.ts` e `tests/e2e/companion.spec.ts` passam.

### Tarefa 7: Fala sincronizada

**Arquivos:**
- Modificar: `features/neura/useNeura.ts`, `features/companion/NeuralBridgeMascot.tsx`, `features/companion/CompanionHud.tsx`
- Testar: `apps/desktop/test/neura-speech-level.test.ts`, `tests/e2e/neura-hud.spec.ts`

**Interfaces:**
- Produz: `speechLevel(samples: Uint8Array): number`, em `companion-motion.ts`, retornando 0–1; `subscribeSpeech(listener: (level: number | null) => void): () => void`, em que `null` significa que não está falando; `useSpeaking(): boolean`.

- [ ] **Passo 1: Testes.** Amostras em 128 → 0; onda cheia → próximo de 1; `subscribeSpeech` emite `null` no fim, no erro e ao interromper por novo `speak`.
- [ ] **Passo 2:** verificar a falha.
- [ ] **Passo 3: Áudio real.** Em `speak`, conectar o `Audio` a `AudioContext` → `AnalyserNode` → destino; publicar o nível por `requestAnimationFrame`; fechar o contexto no fim. Falha do analyser não interrompe a fala.
- [ ] **Passo 4: Fallback.** Em `speechSynthesis`, cada `onboundary` emite 0,8 com decaimento de 180 ms.
- [ ] **Passo 5: Boca.** O rosto `speaking` reutiliza `OpenMouth`; o nível escreve `--nb-mouth` por `ref`, sem re-render do React. Sem nível, o rosto fica estático: boca não se move sem som.
- [ ] **Passo 6:** E2E com fala simulada na fronteira de áudio: `data-mascot-state` vai a `speaking` durante o áudio e volta ao estado anterior depois. Validar com áudio real se o VoiceStudio estiver disponível; caso contrário, registrar como pendência.

### Tarefa 8: Microinterações e troca de sessão

**Arquivos:**
- Modificar: `features/companion/CompanionHud.tsx`, `styles.css`
- Testar: `tests/e2e/companion-motion.spec.ts`

**Interfaces:**
- Consome: `HUD_MS`.
- CSS: tokens `--hud-ms-hover`, `--hud-ms-micro`.

- [ ] **Passo 1: Teste E2E** `slides the detail on session change without remounting the panel`: nó de `.companion-panel` permanece o mesmo; `aria-pressed` muda na hora; o detalhe novo fica visível ao fim de `HUD_MS.session`.
- [ ] **Passo 2:** verificar a falha.
- [ ] **Passo 3: Sessões.** `Details` keyed por `sessionId`, em `AnimatePresence mode="popLayout"` com fundo estável; direção pelo índice na lista, `x: ±12` e opacidade. Marcador de seleção único, com `y` animado pelo `offsetTop` da linha.
- [ ] **Passo 4: Feedback.** Em `.companion-panel__actions button`, `.companion-capsule__toggle`, `.companion-session`, `.companion-cta` e controles do player: hover com `transform`/cor em `--hud-ms-hover`, press com `scale(.96)` em `--hud-ms-micro`. Ícones de pin com rotação de 12°. Lista explícita de propriedades; sem `all`.
- [ ] **Passo 5: Indicadores.** `.companion-dot` com transição de cor; pulso discreto só em `--live`, e pausado por `--suspended`. Em `Events`, só itens novos animam, com `initial={false}` na primeira carga. Alternar Neura/agentes usa crossfade de `HUD_MS.content`.
- [ ] **Passo 6: Mouse no mascote.** `.companion-mascot:hover` eleva 2 px em 180 ms, e a superfície reforça a sombra. Fora do hit-test nada reage.
- [ ] **Passo 7:** E2E e `tests/e2e/visual-qa.spec.ts` passam; snapshots só mudam com justificativa registrada.

### Tarefa 9: Spotify

**Arquivos:**
- Modificar: `features/companion/SpotifyPlayer.tsx`, `features/companion/CompanionHud.tsx:50`, `styles.css:297-316`
- Testar: `tests/e2e/companion-spotify.spec.ts`

**Interfaces:**
- Produz: `CoverCrossfade({ cover, trackId })` e `PlaybackProgress({ playback, now })`, internos ao módulo.

- [ ] **Passo 1: Testes E2E.**
  - `crossfades the cover on a track change`: as duas capas coexistem durante a troca, sem quadro vazio.
  - `keeps the player mounted across playback updates`: a mesma instância do nó `.companion-player`.
  - `keeps the volume gesture across a poll`: o slider não é recriado com o ponteiro pressionado.
  - `does not animate a seek`: salto maior que 2 s vai direto.
- [ ] **Passo 2:** verificar a falha.
- [ ] **Passo 3: Capa e texto.** Decodificar com `img.decode()` antes de trocar, para nunca mostrar capa vazia, e fazer crossfade de `HUD_MS.content`. Título e artista keyed por `trackId`, com `y: 6`. O mesmo vale para a cápsula (`music.title`, linha 50). A chave depende de `trackId`, não do poll.
- [ ] **Passo 4: Progresso.** `PlaybackProgress` em `React.memo`, usando `transform: scaleX` com transição linear de 1 s, sem transição em pausa ou em diferença acima de 2 s.
- [ ] **Passo 5: Controles.** Play/pause com crossfade e `scale` de `HUD_MS.micro`. Remover `key={playback.volume}` e sincronizar `input.value` por `ref` apenas quando não houver gesto ativo.
- [ ] **Passo 6:** `tests/e2e/companion-spotify.spec.ts` passa. Nenhum dado simulado entra no código de produção.

### Tarefa 10: Abrir configurações sem piscar

**Arquivos:**
- Modificar: `apps/desktop/src/main/index.ts:78-85`, `features/companion/CompanionSettingsSection.tsx` ou a rota de Configurações, `styles.css`
- Testar: `tests/e2e/companion.spec.ts`

Configurações não é um painel do HUD: abre na janela principal. O conserto é nela.

- [ ] **Passo 1: Teste E2E** `opens settings without showing the previous route`: a partir de outra rota com a janela oculta, no primeiro quadro visível a hash já é `#/settings`.
- [ ] **Passo 2:** verificar a falha.
- [ ] **Passo 3:** em `openMainRoute`, aguardar a troca de hash e um `requestAnimationFrame` antes de `show()`; em janela nova, mostrar em `ready-to-show`. Mantém a API de `openMainRoute`.
- [ ] **Passo 4:** seções de Configurações entram em sequência, com opacidade e `y: 6`, em 220 ms e stagger de 30 ms, só em CSS. Respeitar reduced motion.
- [ ] **Passo 5:** teste passa, e o foco da janela permanece como hoje.

### Tarefa 11: Validação no Electron real e fechamento

**Arquivos:**
- Modificar: `docs/PLAN.md`, `docs/STATUS.md`, `design-system/neuralbridge-intelligent-workspace/MASTER.md`

- [ ] **Passo 1: Gates.** `npm run typecheck`, `npm run lint`, `npm run build`, `npx vitest run` e `git diff --check` passam.
- [ ] **Passo 2: E2E completo do Companion.** `npx playwright test tests/e2e/companion-hud.spec.ts tests/e2e/companion-motion.spec.ts tests/e2e/companion-real-mouse.spec.ts tests/e2e/companion-spotify.spec.ts tests/e2e/companion.spec.ts tests/e2e/neura-hud.spec.ts` passa, seguido de `companion-packaged.spec.ts` no pacote.
- [ ] **Passo 3: Medir.** Repetir a gravação da Tarefa 1 na mesma matriz. Critérios: p95 de quadro ≤ 20 ms a 60 Hz, nenhuma long task acima de 50 ms em transição, CPU parada ≤ baseline + 0,5 ponto, e HUD responsivo com agentes em execução.
- [ ] **Passo 4: Revisão visual.** Comparar gravações, com ajuste dos tokens se preciso. Conferir 100%/150%, tema claro e escuro, dois monitores se houver, e reduced motion.
- [ ] **Passo 5: Documentar.** Seção de movimento em `MASTER.md`, status e evidências em `docs/PLAN.md`, pendências em `docs/STATUS.md`. Salvar no NeuralBridge Brain a decisão do palco fixo e a causa do teleporte.
- [ ] **Passo 6: Relatório de entrega.** Diagnóstico confirmado, arquivos alterados, estratégia, parâmetros finais, resultados de teste, antes/depois e limitações reais.

## Critérios de aceite

- O mascote não salta em nenhuma transição de modo, em qualquer âncora, e volta à posição exata ao recolher.
- Cliques rápidos sempre terminam no último modo pedido, sem estado inconsistente.
- Sem corte, flicker ou artefato de transparência em gravação a 60 FPS, a 100% e 150%.
- Estados do mascote vêm só de sinais reais; `speaking` só ocorre com fala real.
- Spotify troca de faixa sem reconstruir o player.
- Reduced motion, always-on-top, foco, click-through, posição salva e múltiplos monitores continuam funcionando.
- Resultado validado no Electron real, e empacotado, não apenas em navegador.

## Limitações conhecidas

- Sem dois monitores físicos, o teste correspondente fica pulado e a matriz multi-monitor segue pendente.
- No fallback `speechSynthesis`, a boca acompanha palavras, não amplitude.
- `speaking` com áudio real depende do VoiceStudio instalado; Spotify autenticado depende da pendência já aberta em 42.3.Spotify.
- Soltar o arraste perto da borda ainda envolve um `setBounds`; a Tarefa 1 mede quanto disso aparece.

## Rollback

Sem migração nem mudança de preferência: reverter o código da fase restaura o comportamento anterior, e `companionHud.x/y` continua válido. Campo `layout` é aditivo e removível junto. `motion` sai com a reversão do `package.json` e do lockfile.
