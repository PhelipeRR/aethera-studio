# Smart Chat Agent Failover & Automatic Recovery

## Intenção

Fazer o modo Automático do Chat funcionar como continuidade de execução entre Claude Code e Codex CLI. O agente de destino recebe um pacote de handoff compacto e verificável, não milhões de tokens da conversa anterior.

## Decisões

- **Escopo:** somente Chat; a execução continua sendo uma tarefa do `TaskEngine`.
- **Checkpoint:** persistente após cada etapa segura, com resumo técnico incremental; não após cada evento de ferramenta.
- **Disponibilidade:** estados estruturados `AVAILABLE`, `RATE_LIMITED`, `QUOTA_EXHAUSTED`, `AUTH_REQUIRED`, `UNAVAILABLE` e `UNKNOWN`, distinguindo limite de uso de contexto, autenticação e configuração.
- **Failover:** permitido automaticamente apenas em `auto`; seleção manual aguarda o agente escolhido.
- **Espera:** ambos limitados entram em `WAITING_FOR_CAPACITY`; retomada usa horário confiável ou backoff controlado e só ocorre após nova verificação.
- **Reinício:** o processo principal recupera estados persistidos quando o app abre; não há promessa de execução com o app fechado.
- **UI:** aviso integrado ao Chat, sem nova tela, com status individual, recuperação conhecida, checkbox persistido, tentar novamente e configurações reais.

## Abordagens consideradas

1. **Checkpoint por etapa + resumo incremental (escolhida):** equilibra consistência, custo e capacidade de retomada; reutiliza o limite natural do TaskEngine.
2. **Checkpoint por evento de ferramenta:** granularidade maior, mas captura estados intermediários, aumenta volume e torna retomada idempotente mais difícil.
3. **Gerar contexto apenas no limite:** menor alteração, mas o pior momento para reconstruir o trabalho; não atende à continuidade desejada.

## Estado e handoff

O pacote persistido referencia tarefa e conversa e contém solicitação original, etapa, agente de origem/destino, resumo técnico, histórico relevante limitado, arquivos alterados, diff relevante redigido/limitado, comandos, testes, erros, decisões, pendências, checkpoint e próximo passo. O novo agente deve conferir o estado real do projeto antes de editar.

## Fora do escopo

Não criar motor paralelo, workflow, Mission Control, serviço de background, bypass de quota, troca automática em modo manual ou estimativa inventada de horário.
