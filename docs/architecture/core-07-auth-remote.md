# CORE-07 — Autenticação, pareamento, revogação e acesso remoto

Status: **concluído em 2026-11-09** (commit por lote autorizado pelo usuário). Base: ADR CORE-01 §2.4–2.5 (D-7, D-8) e
contratos CORE-02 (`auth.ts`, `integrations.ts`). Decisão do usuário para este lote: **segredos continuam no S0**
(nenhuma credencial migrada; o Core não guarda segredos de integrações).

## Quem pode chamar o Core

| Chamador | Como prova quem é | Onde | Escopos |
|---|---|---|---|
| Desktop | `Authorization: Bearer` com token aleatório que o Core manda só pelo canal IPC | Só em loopback; recusado se chegar pela tailnet | Todos (inclusive os locais) |
| Aparelho pareado | `Authorization: DPoP <token>` + cabeçalho `DPoP` (JWT ES256 assinado pela chave P-256 do aparelho, preso a método, URL, horário, id único e ao próprio token) | Loopback ou tailnet | Os dados no pareamento |
| Ninguém | — | `/health` só em loopback; pela tailnet até o `/health` exige aparelho | — |

## Pareamento (o desktop sempre confirma)

1. Desktop: **Parear um aparelho** → código de 8 caracteres sem letras ambíguas, válido por 5 min, guardado só como
   hash, com o endereço `https://<pc>.<tailnet>.ts.net` e a impressão digital do Core.
2. App: envia código, nome, plataforma e a chave pública (a privada nunca sai do aparelho).
3. Desktop: "Parear o iPhone de Fulano?" → **Parear** cria o aparelho; **Recusar** encerra.
4. App: troca o pareamento aprovado, uma única vez, por tokens, provando posse da chave.

Tokens: acesso de 15 min e refresh de 30 dias, guardados só como hash. O refresh é rotativo: um refresh já usado que
volta revoga a família inteira, e o aparelho precisa parear de novo. Escopo `devices:manage` nunca vai para aparelho.
Acesso total exige `task:full-access`. Aparelhos criam tarefas somente leitura por padrão. Projetos fora da concessão
e privados respondem `404` (sem IDOR). O stream de todas as tarefas é recusado para quem não vê todos os projetos.

## Revogação, limites e auditoria

- **Revogar** (um ou todos) invalida os tokens na hora e fecha os streams SSE abertos do aparelho.
- **Rate limit**: pareamento 5/min e token 10/min por origem (IP da tailnet vindo do `tailscale serve`), com bloqueio
  progressivo depois de 3 erros (1 min, 5 min, 15 min, 1 h); por aparelho: leitura 240/min, criação de tarefa 20/min,
  comandos 60/min, streams 10/min. O desktop não tem limite de taxa, mas passa pela mesma validação.
- **Auditoria** (`core_audit`): pareamento iniciado, reivindicado, aprovado, recusado e falho; token emitido, renovado e
  reuso detectado; aparelho revogado; acesso negado. Nunca grava código, token, chave ou corpo.

## Acesso remoto (Tailscale)

- O Core continua só em `127.0.0.1`. Com o acesso remoto **ligado pelo usuário**, o Core roda
  `tailscale serve --bg --https=443 http://127.0.0.1:<porta>` (só dentro da tailnet) e volta a publicar a cada início,
  porque a porta é dinâmica. Desligar roda `tailscale serve --https=443 off`.
- `funnel` nunca é chamado. Se o Tailscale estiver com Funnel ligado, o estado vira **bloqueado** e a publicação é
  desfeita.
- O executável é procurado só em `Program Files\Tailscale` (nunca pelo PATH). O Singularity não instala o Tailscale.
- O servidor aceita o nome `*.ts.net` só enquanto a publicação estiver ativa; qualquer outro `Host` continua recusado.

Nesta máquina o Tailscale não está instalado: o fluxo real pela tailnet foi testado com o servidor real e um executor
falso do Tailscale (mesmos comandos e respostas JSON do `tailscale status/serve`). Falta validar com um Tailscale real
e com o app móvel (MOB-01).

## Tela "Dispositivos e acesso remoto" (Configurações)

Liga e desliga o acesso remoto, explica o que falta (Tailscale ausente, sem login, Funnel ligado), gera o código,
mostra a confirmação de pareamento, lista aparelhos com último acesso e escopos, e revoga um ou todos. O renderer
nunca vê token ou chave: o main repassa ao Core com o token do desktop.

## Testes

- `apps/desktop/test/core-auth.test.ts` (11): pareamento completo e uso da API com prova de posse; `/health` e token do
  desktop recusados pela tailnet; confirmação obrigatória e código de uso único; `devices:manage` negado a aparelho;
  prova repetida, de outro método, outra URL, fora do horário, de outra chave e token roubado recusados; rotação e
  reuso de refresh; expiração de token e de código; revogação imediata que fecha o stream; concessão por projeto,
  privado, escopo e Acesso total; rate limit por aparelho; bloqueio progressivo por origem; auditoria sem segredos;
  Tailscale ausente, `serve` sem `funnel`, Funnel bloqueado; pareamento recusado com acesso remoto desligado.
- `tests/e2e/core-devices.spec.ts`: a seção aparece, acesso remoto desligado por padrão e explicado.
- Regressão completa em `docs/STATUS.md`.

## Reverter

Acesso remoto é desligado por padrão e o arquivo `core-remote.json` guarda só `{ enabled }`. Revogar todos derruba
todos os aparelhos. As tabelas `core_*` são aditivas e ignoradas por versões anteriores.
