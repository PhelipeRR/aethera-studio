# Lote COMP-01 — Companion como módulo à parte (extensão, como o Velix)

Status: **COMP-01 implementado, validado e commitado em 2026-11-10 (`ea8e40e`).** A implementação preserva o estado das instalações existentes e mantém Companion, Spotify e Void independentes.

## 1. Objetivo

Hoje o Companion (janela flutuante com o Void, player do Spotify e painel de agentes) faz parte do núcleo do app: ele é
criado sempre ao abrir o app e pode apenas ser ocultado. O objetivo é tratá-lo como um **módulo à parte**, como o Velix:
pode ser habilitado, desabilitado e desinstalado; quando desligado, não abre janela, não faz polling, não aparece no
menu da bandeja nem em Configurações, e o resto do app funciona igual.

## 2. Auditoria (estado atual)

| Item | Onde | Situação |
|---|---|---|
| Mecanismo de extensões | `packages/shared/src/extensions.ts`, `packages/orchestrator/src/extensions/*`, tela Extensões | Manifesto, registro no banco, instalar de uma pasta local, habilitar, desabilitar, atualizar, reverter e desinstalar |
| Velix | `packages/extensions-velix` (`id: 'velix'`) | Só a navegação é condicionada (`routes.ts`: `extensionId: 'velix'`); o main compõe o domínio do Velix sempre |
| Neura/Void | `packages/extensions-neura` (`id: 'neura'`) | Registrada como extensão, mas nada depende do estado dela |
| Companion | `main/companion-hud-window.ts`, `companion-ipc.ts`, `features/companion/*`, 9 handlers `companionHud*` em `index.ts`, item "Mostrar Companion" na bandeja | Sempre criado em `whenReady`; o registro de capacidades de IPC **já** o classifica como extensão (`neura` + `companion` + `spotify`, `tier: 'extension'`), mas ninguém consulta esse estado |
| Spotify | `main/spotify/*`, `SpotifySettingsSection`, player no HUD | Só aparece no Companion; o polling liga quando o HUD está visível |
| Void voz | `neura-runtime`, `neura-ipc` | Usa o HUD para mostrar estado e sugestões; funciona sem ele pela janela principal |
| Instalação de extensões embutidas | — | **Não existe catálogo de extensões que vêm junto com o app.** O Velix só se instala apontando uma pasta com `extension.json`. Sem um catálogo embutido, um usuário que desabilitasse ou desinstalasse o Companion não conseguiria trazê-lo de volta |

## 3. Decisões que dependem do usuário

| # | Pergunta | Opções | Recomendação |
|---|---|---|---|
| D-COMP-a | O Companion é uma extensão própria ou se junta ao Void? | A) extensão `companion` (janela + Spotify), separada do Void; B) uma extensão só, "Void" (janela + voz + Spotify) | **A — confirmado**: Companion separado do Void |
| D-COMP-b | Instalações novas vêm com o Companion ligado? | ligado / desligado (como o Velix) | **Desligado — confirmado** |
| D-COMP-c | Quem já usa o app | manter ligado automaticamente na atualização / desligado | **Preservar o estado atual — confirmado** |
| D-COMP-d | O Spotify vai junto com o Companion? | sim / extensão própria | **Extensão própria — confirmado** |

## 4. Arquitetura proposta

1. **Manifestos embutidos no registro existente**: `BUILTIN_EXTENSION_MANIFESTS` registra `companion` e `spotify` na
   mesma tabela e nos mesmos contratos das extensões instaladas. O registro é idempotente: em instalação nova o
   Companion começa desabilitado; se `preferences.json` já existia, o estado inicial é habilitado e qualquer estado
   persistido prevalece. Não há cópia de credenciais nem pacote paralelo.
2. **Porteiros no main**: o main consulta o estado das extensões ao iniciar e quando ele muda.
   - Companion habilitado: cria a janela do HUD, registra os handlers `companionHud*` e o item da bandeja.
   - Companion desabilitado: destrói a janela e tira o item da bandeja; os canais `companion*` respondem
     `unavailable` (nenhum dado vaza).
   - Spotify é porteado pelo seu próprio gate; seu polling, conexão e requisições remotas ficam parados quando a
     extensão Spotify está desabilitada, preservando configuração e tokens para reativação.
   - A troca vale **na hora, sem reiniciar**.
3. **Renderer**: as seções Companion e Spotify em Configurações e qualquer atalho para o HUD usam o `extensionId`
   correspondente; desligar uma extensão não desliga automaticamente a outra.
4. **Void sem Companion**: a voz e o chat do Void continuam; as sugestões que hoje saem do mascote aparecem na janela
   principal (notificação discreta), sem quebrar o fluxo atual.
5. **Migração (aditiva, uma vez)**: na primeira abertura depois da atualização, o Companion é registrado preservando
   o estado atual para quem já usa o app (D-COMP-c). Nada é apagado: posição, modo, fixação e configurações do
   Spotify continuam em `preferences.json`.
6. **Identidade técnica**: nada muda (decisão D-1): `appId`, pasta de dados, MCP e pacotes `@neuralbridge/*`.

## 5. Fora do escopo

- Companion Mobile (é o MOB-01).
- Mudar o visual do Companion ou do Void.
- Tirar o Void da marca (logo, ícone e chat vazio continuam no núcleo).
- Trocar a palavra de ativação "Neura".

## 6. Riscos

| Risco | Mitigação |
|---|---|
| Usuário desliga e não sabe trazer de volta | Catálogo embutido com "Ativar" na tela Extensões; a bandeja mostra "Companion desativado — ativar em Extensões" |
| Handlers registrados duas vezes ao religar | O porteiro registra uma vez e responde `unavailable` quando desligado, em vez de remover e recriar handlers |
| Void depende do HUD em algum fluxo escondido | Testes do Void com Companion desligado (voz, sugestões, reunião) |
| Testes atuais assumem o Companion sempre presente | Os testes do Companion habilitam a extensão como o Velix faz hoje (`velix-extension.ts`); testes novos cobrem o desligado |
| Polling ou janela residual com a extensão desligada | Teste confere: nenhuma janela `companion=hud`, nenhum pedido ao Spotify, nenhum timer do HUD |

## 7. Testes planejados

- **Unidade**: porteiro (ligar, desligar e religar sem reiniciar; canais `unavailable`; sem registro duplicado);
  catálogo embutido (instalar, ativar, versão mínima do Core); migração única para quem atualiza.
- **E2E**:
  - Instalação nova: Companion desligado por padrão (D-COMP-b).
  - Desligar em Extensões: a janela some na hora; bandeja e Configurações sem Companion e Spotify; Void continua.
  - Religar: a janela volta na mesma posição e no mesmo modo.
  - Desinstalar e reinstalar pelo catálogo embutido.
  - Atualização de uma pasta de dados antiga: o Companion continua ligado.
  - Velix instalado pelo catálogo embutido, sem escolher pasta.
  - Suítes atuais do Companion, Spotify, Void e acessibilidade verdes.
- **Empacotado**: o catálogo embutido e o Companion ligado e desligado no app instalado.

## 8. Critérios de aceite

1. Com o Companion desligado: nenhuma janela flutuante, nenhum polling do Spotify, nenhum item de bandeja, nenhum
   canal `companion*`/`spotify*` respondendo dados; o resto do app (chat, Core, Void voz, Velix) igual.
2. Ligar e desligar valem na hora, sem reiniciar.
3. Quem atualiza continua com o Companion como estava; nenhuma preferência perdida.
4. Velix, Void e Companion instaláveis pelo catálogo embutido.
5. Suíte completa (Vitest e E2E) sem regressão; acessibilidade verde.

## 9. Reversão

Desinstalar a extensão desliga o Companion; reinstalar pelo catálogo o traz de volta com as preferências. No código, o
porteiro tratar `companion` como sempre habilitado volta ao comportamento atual. A migração só insere um registro na
tabela `extensions`; nenhum dado é apagado.

## 10. Ordem de execução

1. COMP-01a: catálogo de extensões embutidas, com testes.
2. COMP-01b: pacote `extensions-companion`, porteiro no main e migração para quem já usa.
3. COMP-01c: renderer (Configurações, Extensões e bandeja) e Void sem Companion.
4. COMP-01d: E2E, empacotamento e regressão completa.

Cada sub-lote recebe um commit próprio, se o usuário mantiver a regra dos lotes do Core.

## Estado da implementação autorizada

O registro embutido, os gates do HUD/Spotify e o callback de transição IPC foram implementados nesta rodada. Não foram
alterados TaskEngine, Singularity Core, palavra de ativação, credenciais ou banco fora do registro aditivo de extensões.
O catálogo completo de reinstalação dos built-ins continua fora deste lote e é uma limitação conhecida.
