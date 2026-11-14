# Neura: privacidade, dados e limites

A Neura vem desligada. Cada coisa que observa o usuário tem consentimento próprio em **Configurações → Neura**, e retirar o consentimento encerra na hora a sessão que ele cobria.

## O que acontece com cada dado

| Dado | Onde é processado | O que fica guardado |
|---|---|---|
| Áudio do microfone | Whisper do VoiceStudio, neste computador, por `localhost` | Nada. Só trechos com fala saem do HUD, ficam em memória e são descartados depois de transcritos |
| Comandos conhecidos (música, abrir app, pausar) | Localmente, por regras fixas | Ações no computador ficam na auditoria (`neura_action_audits`) |
| Outros pedidos à Neura | Agente escolhido (Claude ou Codex), em execução somente leitura | Histórico de tarefas do projeto, inclusive o texto do pedido |
| Trechos de reunião colados | Worker local, quando existe, e depois o agente escolhido | Em memória até encerrar a reunião; o texto enviado ao agente também fica no histórico de tarefas |
| Sugestões | Geradas pelo agente | Em memória, ou em `neura_suggestions` se "Guardar o histórico de sugestões" estiver ligado |
| Fala da Neura | VoiceStudio por `localhost`, ou vozes locais do sistema | Nada |

**Atenção:** o texto enviado ao agente segue a política do provedor desse agente e pode sair deste computador. "Apagar histórico de sugestões" remove só as sugestões. O histórico de tarefas do projeto é apagado pelas telas de tarefas, e a auditoria de ações é mantida de propósito.

## Reuniões

- Há duas fontes: o texto que o usuário cola, como legendas, e o áudio do computador. O áudio exige um consentimento próprio e só é capturado depois de tocar em **Ouvir a call**. Termina ao encerrar a reunião, pausar tudo, retirar o consentimento, ocultar ou fechar o Companion, ou depois de 4 horas.
- A captura pega tudo o que o computador reproduz, inclusive música e vídeos, e não pega o microfone. O sistema exige pedir também a tela: o vídeo é descartado na hora, sem ser lido.
- Enquanto ouve a call, a Neura não aceita comandos de voz, porque o microfone pode ouvir as caixas de som e outra pessoa poderia dar ordens a ela.
- O áudio vai só para o VoiceStudio local, é transcrito e descartado. Nada é gravado. A transcrição fica em memória até encerrar a reunião.
- Frases que parecem pedir resposta vão ao agente escolhido, com as falas recentes, e podem sair deste computador; esse pedido também fica no histórico de tarefas do projeto. O aviso **Ouvindo a call** fica visível em todos os modos do Companion enquanto a captura está ativa.
- Durante a reunião, o HUD fica fora de capturas de tela, nos programas que respeitam essa proteção do Windows.
- Não existe integração nativa com o Teams. Uma sessão pedida como Teams aparece como genérica e degradada.
- A Neura nunca envia nada à reunião. Copiar, falar e aceitar ficam com o usuário.
- O usuário responde por avisar os participantes quando a lei ou as regras da organização exigirem.

## Ações no computador

| Ação | Política |
|---|---|
| Spotify, volume, abrir Spotify ou Teams | Automática e auditada |
| Abrir Configurações do Windows | Pede confirmação, que expira em 60 segundos |
| Abrir qualquer outro programa | Bloqueada e auditada |
| Digitar ou clicar na tela | Não existe nesta versão |

O texto ouvido ou digitado nunca vira linha de comando, URL ou nome de programa. **Pausar tudo**, por voz ou no Companion, encerra a escuta e as reuniões até o usuário retomar.

## Limites conhecidos

- A voz exige o VoiceStudio aberto. Sem ele, o Companion mostra voz indisponível e a entrada por texto continua funcionando.
- O reconhecimento OneCore do Windows não é usado: o ditado dele exige a "fala online", que envia o áudio à Microsoft.
- Cada frase leva alguns segundos para ser transcrita, então a resposta por voz não é imediata.
- A palavra de ativação depende da transcrição do Whisper.
- A detecção local de idioma cobre português, inglês e espanhol.
- O worker Python é opcional e o Python não acompanha o instalador. Sem ele, o agente recebe as últimas linhas da reunião, limitadas em tamanho.
