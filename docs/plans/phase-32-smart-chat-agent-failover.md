# Fase 32 — Smart Chat Agent Failover & Automatic Recovery

**Status:** CONCLUÍDA em 2026-10-30, com o desenho aprovado pelo usuário. Evidências em `docs/STATUS.md`.

## Objetivo

Permitir que o modo Automático do Chat alterne entre Claude Code e Codex CLI quando um agente atingir um limite real de uso, preservando a mesma conversa, execução, arquivos, mensagens e contexto técnico. Se ambos estiverem limitados, a execução fica aguardando capacidade e pode retomar automaticamente quando o app voltar e detectar disponibilidade.

## Escopo e limites

- Exclusivamente o módulo Chat existente.
- Não criar nova página, Mission Control, Workflow ou Autonomous Mission Mode.
- Reutilizar `TaskEngine`, failover existente, adaptadores CLI, persistência de tarefas/sessões e IPC atual.
- O app fechado não executa em segundo plano; a recuperação ocorre na próxima inicialização.
- Seleção manual nunca troca silenciosamente de agente.
- Limites e horários não serão inventados nem inferidos apenas por tokens de contexto.

## Subfases

| Subfase | Entrega | Dependências | Status |
|---|---|---|---|
| 32.1 | Disponibilidade estruturada e classificação de limite | adaptadores, `TaskEngine` | PLANEJADA |
| 32.2 | Checkpoints incrementais, resumo técnico e handoff Chat → Chat | 32.1, persistência de tarefas | PLANEJADA |
| 32.3 | Failover durante execução e espera persistida por capacidade | 32.1, 32.2 | PLANEJADA |
| 32.4 | Feedback no Chat existente e retomada automática | 32.3, IPC atual | PLANEJADA |
| 32.5 | Testes unitários, integração, E2E e validação real controlada | 32.1–32.4 | PLANEJADA |

## Critérios de aceite

- Automático escolhe agente disponível antes de iniciar e troca somente após evidência de limite.
- Claude → Codex e Codex → Claude preservam a mesma solicitação e conversa.
- Checkpoint transacional por etapa contém progresso, arquivos, comandos, testes, erros, decisões e próximo passo seguro.
- Resumo técnico é atualizado incrementalmente, tratado como dado não confiável e limitado em tamanho.
- A mesma execução não inicia dois agentes concorrentes nem repete operações concluídas.
- Ambos limitados produzem estado de espera persistido, com status individual e horários somente quando confiáveis.
- Checkbox de retomada automática, Tentar novamente e Configurações de uso têm ações reais.
- Reinício do Electron recupera execuções aguardando capacidade sem exigir nova mensagem.
- Manual Claude/Codex permanece manual, inclusive durante limite.
- Testes cobrem disponibilidade, streaming, ferramenta, handoff, arquivos, reinício, cancelamento, loops e duplicação.

## Modelo de segurança

O conteúdo produzido por agentes, diffs, comandos, resultados e resumos entra no handoff como dado não confiável. O handoff não concede permissões, não aprova etapas e não autoriza comandos. Retomada de edição exige que o checkpoint e o snapshot ainda sejam compatíveis; se não forem, a execução pausa para decisão explícita.
