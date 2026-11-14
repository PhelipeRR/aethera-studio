# Fase 34 — Velix: projeto Video, narração, temas, pesquisa e prints

**Status:** 34.1 CONCLUÍDA em 2026-10-30; 34.2 IMPLEMENTADA, aguardando validação com agente real; 34.3 CONCLUÍDA; 34.4 e 34.5 IMPLEMENTADAS, aguardando um vídeo real completo. Desenho aprovado pelo usuário.

## Objetivo

Todo o Velix passa a trabalhar em um único projeto, escolhido pelo usuário ("Video"), com uma pasta por vídeo. O usuário escolhe entre fazer um vídeo sobre um tema ou um vídeo para um projeto cadastrado.

## Decisões

- O projeto Video é uma preferência (`velixProjectId`). O processo principal resolve a pasta a partir do ID; o renderer não informa a raiz ao preparar um vídeo.
- Cada vídeo fica em `<Video>/<slug>/`, com `pesquisa/`, `narracao/` e `renders/`. O modo projeto acrescenta `prints/`. Repetir o nome reaproveita a pasta, sem apagar nada.
- A tarefa roda sempre no projeto Video. O projeto-alvo nunca é editado, e a fase não amplia permissões.
- Escolher um projeto não executa nada: a captura automática (34.5) exige confirmação do comando e revisão dos prints.

## Subfases

| Subfase | Entrega | Status |
|---|---|---|
| 34.1 | Projeto Video fixo, pastas por vídeo, modos tema e projeto | CONCLUÍDA |
| 34.2 | Roteiro falado, `narracao/elevenlabs.txt`, espera pelo áudio manual e montagem com as cenas ajustadas à fala | IMPLEMENTADA, falta validação real |
| 34.3 | Nicho e sugestão de temas | CONCLUÍDA |
| 34.4 | Pesquisa na web por etapa, com licenças e `fontes.md`; web nunca na etapa que edita | IMPLEMENTADA, falta vídeo real completo |
| 34.5 | Prints automáticos de apps web e Electron, com comando confirmado e revisão obrigatória | IMPLEMENTADA, falta vídeo real completo |

## Narração (34.2)

O Extra "Narração ElevenLabs" acrescenta ao prompt as regras do fluxo. O agente escreve `narracao/elevenlabs.txt`, para sem renderizar, espera `narracao/voz.mp3` e só então transcreve, ajusta as cenas à fala, renderiza e roda o qc.

- O texto sai sem tags nem SSML: pontuação funciona em todos os modelos, e marcações específicas de um modelo podem ser lidas em voz alta em outro.
- O tamanho é estimado em 2,5 palavras por segundo quando a duração é escolhida.
- A parada é uma instrução ao agente, não uma trava do app. A primeira transcrição baixa um modelo de cerca de 640 MB.

## Nicho e temas (34.3)

No modo tema, o usuário escolhe ou digita um nicho e clica em "Sugerir temas". O clique faz uma pergunta curta ao agente, em modo somente leitura e fora do TaskEngine, porque nada é editado. A ordem é Claude e depois Codex; agente indisponível ou com falha é pulado. Escolher um tema preenche a ideia e, se estiver vazio, o nome do vídeo.

Sem pesquisa (34.4), as sugestões vêm só do conhecimento do agente, então o prompt proíbe dados e fatos recentes. Cada clique consome o plano do usuário. O nicho é tratado como dado.

## Pesquisa (34.4)

O botão "Pesquisar referências" faz uma pergunta ao Claude Code fora do TaskEngine, com `allowedTools` limitado a `WebSearch` e `WebFetch`: sem arquivos, comandos ou MCP. O usuário marca o que aprova. Ao começar, o processo principal, e não um agente, baixa as imagens aprovadas para `pesquisa/` e grava `pesquisa/fontes.md`. A tarefa de edição recebe só esse material, como dado não confiável.

- **Download:** só https em host público, sem IP literal; cada redirecionamento é conferido; limite de 15 MB; o tipo vem dos bytes (PNG, JPG, GIF, WEBP), então SVG e HTML são recusados.
- **Gráficos** são recriados a partir dos dados, e tipografias ficam listadas sem download.
- **Limites:** um nome público que resolva para IP privado não é detectado. A licença é a que a página informa. Só o Claude pesquisa; o Codex não tem essa etapa. A etapa de edição com Codex mantém a rede que o projeto já concede, então a instrução de não buscar na web não é uma trava técnica nesse caso.
- **Validação real (2026-10-30):** com o Claude Code autenticado, a sugestão devolveu temas e a pesquisa devolveu 10 referências, com download de 1 imagem e recusa de 1 SVG.

## Prints automáticos (34.5)

Em "Fazer vídeo para um projeto", "Preparar captura" pede a um agente, somente leitura e com a pasta do alvo como `cwd`, um plano: tipo, comando, endereço, variáveis e telas. O usuário vê e edita tudo, confirma que o comando vai rodar código e clica em "Capturar telas". O app sobe o projeto, captura, para sempre a árvore de processos e grava em `prints/`. Os prints passam por revisão obrigatória antes de liberar "Começar com o Velix".

- **Comando:** um único programa entre npm, pnpm, yarn, bun, npx e node, sem operadores de shell, porque o texto pode vir do conteúdo do repositório. Um script do projeto ainda roda o código dele: por isso a confirmação.
- **Web:** janela descartável, offscreen, com sandbox, sessão própria e sem preload. O tamanho vem de emulação, porque o Windows limita janelas à altura da tela e uma janela oculta não pinta.
- **Electron:** porta de depuração (`--remote-debugging-port`), que preserva o preload. O formato padrão é horizontal, porque telas desktop ficam vazias em 9:16.
- **Endereço:** só `localhost` e `127.0.0.1`. Toda chamada de captura tem limite de tempo, para o projeto nunca ficar rodando.
- **Limites:** apps com login capturam o que estiver aberto; redirecionamentos do servidor são barrados pelo bloqueio global de navegação; outros tipos de app seguem com prints manuais. Essa etapa não amplia a leitura do agente da tarefa, que usa só `prints/`.
- **Validação real (2026-10-30):** o Claude Code propôs o plano do próprio NeuralBridge em 28 s, com dados de demonstração e 8 telas; a captura Electron real gerou 2 prints e encerrou o app.

## Um agente só (correção de 2026-10-30)

O prompt do Velix passa de 80 palavras, e o roteador classifica isso como `complex`, indo para planejar, implementar e revisar. Esse fluxo não sabe esperar: na primeira tarefa real, o Codex parou corretamente para pedir aprovação, a revisão reprovou a pausa, o texto foi escrito sem aprovação do plano e a tarefa terminou em "Falhou" depois de 3 correções, gastando cerca de 3,5 milhões de tokens de entrada, a maior parte em cache. O Velix agora escolhe sempre um agente: o escolhido, o preferido do projeto, ou o Codex, com o Claude como alternativa.

## Interface

A página do Velix foi reorganizada em três abas (Criar com o Velix, Render direto, Importar vídeo), com o projeto Video no cabeçalho e uma ficha do vídeo fixa ao lado do formulário. Render e Importar agora dizem o que falta para liberar a ação. Causa do botão Importar apagado: ele depende de pasta, link e confirmação, e a pasta vinha de um campo vazio em outro painel, sem aviso na tela.

## Limites conhecidos da 34.1

- O modo projeto informa nome e pasta do alvo ao agente, mas o acesso de leitura fora do projeto Video depende do agente: o Claude headless não tem `--add-dir` aqui, e `participants` só cobre filhos de workspace. Com a 34.5, o agente que lê o alvo é a etapa somente leitura do plano de captura; a tarefa de vídeo usa só `prints/`.
- A criação do projeto Video usa a tela Projetos; a página do Velix só aponta para ela.
