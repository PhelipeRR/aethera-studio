# CORE-11 — Automações Git como disparadoras do Core

As automações Git não formam um executor separado. O monitor continua no Desktop porque lê refs e diffs do workspace,
mantém cursores/dedupe e aplica limites de disparo. Quando uma alteração é aceita, ele chama `workflows.run()`; a etapa de
agente resultante usa a ponte CORE-10, o lease e a idempotência do Core.

Isso fecha a fronteira sem mover operações Git nativas para o Core: leitura de refs, comparação de arquivos e regras de
gatilho continuam locais; execução de agentes continua exclusivamente no Core quando disponível. `NB_CORE_TASKS=main`
permanece o rollback operacional.

Evidência: `git-automation-monitor`, `git-automation-runtime` e testes de gatilho existentes, além dos 25 testes do
coordenador de Workflows. Não há mudança de banco nem novo processo.
