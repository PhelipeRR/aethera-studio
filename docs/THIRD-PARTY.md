# Componentes de terceiros

Registro de origem e licença de bibliotecas e ativos acrescentados a partir da Fase 19. Dependências anteriores seguem as licenças declaradas em seus próprios pacotes (`npm ls`).

## Fase 19 — Neural Brain 3D

| Componente | Versão | Licença | Uso |
|---|---|---|---|
| `three` | 0.186.1 | MIT | Renderização WebGL (geometrias, shaders, controles de órbita de `three/examples`). |
| `@react-three/fiber` | 9.8.2 | MIT | Integração do laço de renderização do three.js com o React. |
| `@types/three` | 0.186.0 (desenvolvimento) | MIT | Tipos TypeScript do three.js. |

Licenças lidas em `node_modules/<pacote>/package.json` em 2026-10-29.

**Modelo do cérebro:** nenhum ativo de terceiros. A anatomia (hemisférios com sulcos, fissura longitudinal, lobos temporais, cerebelo e tronco encefálico) é gerada por funções de distância com sinal em `apps/desktop/src/renderer/src/features/brain3d/anatomy.ts`, escritas para este projeto. Não há malha, textura nem imagem externa no pacote.

**Não usado:** `@react-three/drei` foi avaliado e descartado. Dele só seriam usados os controles de órbita, que o `three` já fornece, e ele traz dependências com acesso à rede (por exemplo, `detect-gpu` busca dados em CDN), além de `hls.js` e `@mediapipe/tasks-vision`.

**Imagem de referência** (`docs/assets/phase-19-reference.png`): fornecida pelo usuário só como referência visual para a revisão; não é distribuída no aplicativo.

## Fase 31 — Workflow Builder

| Componente | Versão | Licença | Uso |
|---|---|---|---|
| `@xyflow/react` | 12.12.0 | MIT | Canvas do editor de workflows. |
| `@dagrejs/dagre` | 3.1.3 | MIT | Layout automático do canvas. |

## Fase 39 — Velix Motion Engine

| Componente | Versão | Licença | Uso |
|---|---|---|---|
| `remotion`, `@remotion/player`, `@remotion/renderer` | 4.0.539 | Remotion License (gratuita para pessoas físicas, empresas de até 3 funcionários e entidades sem fins lucrativos; demais casos exigem Company License) | Composição, prévia e render. |
| `@remotion/bundler` | 4.0.539 (desenvolvimento) | Remotion License | Gera os templates no build; fora do pacote. |
| `@remotion/compositor-win32-x64-msvc` | 4.0.539 | Remotion License; inclui FFmpeg e FFprobe | Render e pós-processamento no app empacotado. |
| Chrome Headless Shell | Baixado pelo Remotion | Google Chrome for Testing | Baixado sob demanda, por ação do usuário; não vem no instalador. |

## Fase 36 — VoiceStudio (provider opcional externo, não distribuído)

| Componente | Versão/contrato | Licença | Uso/status |
|---|---|---|---|
| VoiceStudio local API | contrato 0.5.x, homologado na 0.5.7; `http://localhost:3900`; `POST /v1/audio/speech` | Aplicativo AGPL-3.0; modelos, vozes e saída exigem análise própria (OmniVoice: pesos CC-BY-NC, uso comercial restrito) | Provider opcional por conexão loopback; não é dependência, não é empacotado e não é distribuído pelo NeuralBridge. |

Fontes primárias auditadas em 2026-11-01: [API local](https://voicestudio.sh/docs/local-api), [quickstart](https://voicestudio.sh/docs/quickstart) e [repositório/licença](https://github.com/debpalash/VoiceStudio). O NeuralBridge agora possui um adapter opcional que conecta somente à instalação externa em loopback, sem empacotar VoiceStudio, modelos ou vozes. A geração exige confirmação explícita das licenças do aplicativo, modelo, voz e saída; nenhuma autorização comercial ou de distribuição é presumida. ElevenLabs permanece preservado.

## Remotion — análise de distribuição

O app usa `remotion`, `@remotion/player`, `@remotion/renderer` e o compositor Windows para composição/renderização; o navegador é baixado sob demanda e não é distribuído no instalador. A licença pública do Remotion permite cenários específicos sem Company License, mas empresas acima do limite divulgado e outras distribuições comerciais exigem revisão jurídica e eventual Company License. A proibição de sublicenciamento também precisa ser analisada antes de distribuir o instalador. Esta nota é técnica, não parecer jurídico; a Fase 39 permanece aberta até a decisão formal.

## Neura

Sem dependências novas. A voz usa componentes do próprio sistema (`System.Speech` do Windows e `speechSynthesis` do Chromium). O worker local usa só a biblioteca padrão do Python, que não acompanha o instalador. O Spotify é acessado pela Web API oficial.

## Fase 50 — Singularity (lote 50.02)

| Componente | Versão | Licença | Uso |
|---|---|---|---|
| `@fontsource-variable/inter` | 5.3.0 | OFL-1.1 | Fonte principal da interface (Inter variável, pesos 100–900). |

Licença lida com `npm view @fontsource-variable/inter license` em 2026-11-08. Removido no mesmo lote: `@fontsource-variable/ibm-plex-sans`, que deixou de ser importado. A IBM Plex Mono continua sendo a fonte de código.

**Imagem de referência** (`docs/assets/singularity/reference-memory-galaxy.webp`): fornecida pelo usuário só como referência visual; não é distribuída no aplicativo. O símbolo `SingularityMark` (horizonte de eventos com anel dourado) é um SVG escrito para este projeto.
