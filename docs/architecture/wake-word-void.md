# Wake word — Void com alias Neura

## Decisão

`Void` é a palavra de ativação principal a partir desta versão. `Neura` permanece como alias padrão e configurável para
não quebrar hábitos existentes. A configuração vive em `neura.wakeWord` e `neura.wakeWordAliases`, com defaults
aditivos para preferências antigas.

## Compatibilidade

O parser continua aceitando as variações fonéticas históricas de Neura quando o alias padrão está presente. A palavra é
removida do texto antes da intenção ser interpretada; nenhuma palavra de ativação vira comando de shell, URL ou nome de
aplicativo. A configuração é lida dinamicamente pelo `VoiceGateway`, portanto uma alteração não exige reiniciar o app.

## Rollback

Definir a palavra principal como `Neura` e manter `Void` nos aliases restaura o comportamento anterior sem alterar sessões,
histórico, credenciais, IPC ou o Core. A remoção de `Neura` não é automática e só ocorre pela ação explícita do usuário.
