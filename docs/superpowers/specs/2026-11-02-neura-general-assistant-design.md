# Neura — assistente pessoal geral com reuniões

## Intenção

Transformar o NeuralBridge em um assistente pessoal chamado por voz como “Neura”, capaz de conversar com o usuário, acompanhar reuniões com consentimento e executar ações úteis no computador. O produto deve começar como copiloto observável e evoluir para automação controlada, sem executar ações sensíveis silenciosamente.

## Objetivos

- Conversa por voz com ativação por “Neura”, resposta falada e texto no HUD.
- HUD persistente, discreto e configurável sobre as janelas do Windows.
- Observação de reuniões do Teams e outras fontes autorizadas de áudio/transcrição.
- Detecção do idioma da reunião, do trecho/pergunta e do idioma preferido do usuário.
- Sugestões de resposta no idioma correto, com opção de copiar, editar, falar ou enviar somente após confirmação.
- Integração direta com Spotify para busca, reprodução, pausa, volume, fila e playlists.
- Integrações oficiais sempre que existirem; controle visual do computador como fallback.
- Permissões, auditoria, pausa imediata e indicação clara quando áudio/tela estiverem sendo observados.

## Fora do escopo inicial

- Responder ou enviar mensagens automaticamente em reuniões sem confirmação.
- Gravar reuniões ou armazenar áudio bruto por padrão.
- Controle irrestrito do computador sem escopo, confirmação ou trilha de auditoria.
- Criar integrações privadas/frágeis contra serviços que já tenham API oficial.

## Abordagens consideradas

1. Integrações oficiais como base: mais segura e estável, mas limitada onde não houver API.
2. Controle visual da tela como base: maior cobertura, porém frágil e mais invasivo.
3. Híbrida, escolhida: APIs oficiais para Spotify, agenda e serviços compatíveis; visão/controle de tela apenas como fallback explícito.

## Decisão

Adotar a arquitetura híbrida, iniciando por integrações oficiais e adicionando automação visual por capacidade, com permissões independentes. O HUD e o Companion já existentes devem ser estendidos, preservando seus contratos e evitando um segundo motor de execução.

## Componentes propostos

- **Voice Gateway:** wake word, captura, transcrição, detecção de idioma, síntese de voz e interrupção.
- **Assistant Orchestrator:** interpreta intenção, mantém contexto curto e escolhe uma ferramenta autorizada.
- **Meeting Copilot:** recebe transcrição autorizada, identifica perguntas dirigidas ao usuário, gera sugestões e registra idioma/confiança.
- **Integration Adapters:** Spotify primeiro; depois calendário, e-mail, tarefas e mensageria.
- **Computer Action Broker:** ações de baixo risco por APIs/sistema; automação visual somente com escopo e confirmação.
- **HUD/Companion:** estado de escuta, reunião, idioma, sugestão, permissão pendente, execução e botão de pausa.
- **Privacy and Audit:** consentimento, retenção configurável, logs de ação e exclusão de dados.

## Regra de idioma

Cada evento de reunião terá `meetingLanguage`, `utteranceLanguage`, `userPreferredLanguage` e confiança. A sugestão segue o idioma da pergunta quando confiável; caso contrário, segue o idioma predominante da reunião. O HUD permite alternar/mostrar tradução e nunca envia a sugestão automaticamente na primeira versão.

## Modelo de autonomia

- **Observar:** pode ouvir/transcrever somente após ativação e consentimento.
- **Sugerir:** pode gerar texto/áudio e preparar ações.
- **Confirmar:** usuário aprova cada envio, compra, exclusão, publicação ou alteração importante.
- **Automático seguro:** Spotify, volume, abrir aplicativo e rotinas explicitamente aprovadas.
- **Pausar tudo:** comando de voz e controle visual no HUD.

## Entrega incremental

1. Voz básica + HUD de conversa + preferências de idioma.
2. Spotify por API oficial.
3. Captura/transcrição autorizada de reunião + detecção de idioma.
4. Sugestões de resposta e histórico local controlável.
5. Broker de ações do computador com permissões e auditoria.
6. Automações pessoais, calendário, e-mail e rotinas por contexto.

## Questões para fechar antes da implementação

- Qual fonte de transcrição será usada quando o Teams não expuser uma transcrição acessível?
- O áudio/transcrição deve ser processado localmente, em serviço remoto, ou com escolha por reunião?
- Quais ações entram na lista inicial de “automático seguro”?
- O Neura deve apenas sugerir respostas ou também poder digitá-las no chat do Teams após confirmação?
