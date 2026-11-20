# MotionVelix v2.7.3: o editor de vídeo e motion que mora dentro do Claude

Você não abre programa nenhum. Você conversa com o **Velix**, o robô editor da skill. Ele aparece no chat com telas interativas:

- pede seus takes ou pergunta se é para criar do zero
- mostra o que tem e o que falta, e sugere melhorias
- monta o plano para você aprovar
- entrega o MP4 final revisado quadro a quadro

## Requisitos

- **Claude Pro ou superior**, com execução de código ativada.
- **Onde usar:**

| Ambiente | Como fica |
|---|---|
| **Cowork (app Claude no computador)** | **Recomendado.** As telas do Velix aparecem no chat. Conecte a pasta dos seus vídeos para mandar arquivos grandes (4K, vídeos longos) sem upload. |
| Claude Code | Funciona completo. As telas viram perguntas de clicar no terminal. |
| Chat do claude.ai (navegador/celular) | Bom para testar e para vídeos curtos. Arquivos grandes podem esbarrar no limite de upload. |

## Instalação (2 minutos)

1. Instale a skill:
   - **Claude/Cowork:** Configurações → Capacidades → Skills → **Enviar skill** → selecione `motionvelix.zip`.
   - **Claude Code:** copie a pasta `motionvelix/` para `~/.claude/skills/`.
2. Abra uma conversa nova e diga: **"oi Velix"** ou **"configura o MotionVelix"**.
   O Claude roda `scripts/setup.py`, que instala e testa tudo sozinho: navegador de render, FFmpeg, legendas automáticas, análise de áudio e visão.
   A primeira legenda baixa o modelo de fala uma vez (~640 MB, do GitHub). As próximas são imediatas.
3. **Opcional (nível estúdio):** conecte o **Magnific** ou o **Higgsfield** ao Claude via MCP (Configurações → Conectores). Com eles as criações ficam ainda melhores: narração com voz realista, trilha original, imagens, cenas e B-roll por IA. Usa os créditos da sua conta nessas ferramentas, e o Velix sempre avisa o custo antes.

## Seu primeiro vídeo, passo a passo

1. **Crie uma pasta** no computador, por exemplo `Documentos > MotionVelix`.
2. **Coloque nela tudo o que o vídeo vai usar:**
   - vídeos (MP4, MOV)
   - músicas ou narração (MP3, WAV, M4A)
   - imagens ou logo (PNG, JPG)
3. **Abra uma tarefa nova no Cowork** e diga **"oi Velix"**.
4. Na tela do Velix, responda **"Numa pasta do meu computador"** e informe o nome da pasta.
5. **Quando aparecer o aviso de permissão, clique em Permitir.** O Velix lista o que encontrou, analisa e mostra o plano.
6. Aprove o plano. O vídeo final é salvo **na mesma pasta**.

> **Arrastar no chat ou pasta?** Arquivos leves (imagens, logo, áudio curto, vídeo curto) você pode simplesmente arrastar para a caixa de mensagem do Claude. Vídeos longos, 4K ou vários arquivos: use a pasta.
>
> Por que pasta e não anexo para vídeos? O anexo do chat pode falhar com arquivos grandes, filtros de rede ou antivírus ("Falha no upload"). A pasta não tem limite de tamanho e o resultado já volta para o seu computador.

## Exemplos de pedido

- "Velix, transforma esse podcast de 20 minutos num reel de 45s com o trecho mais forte."
- "Coloca uma legenda dinâmica e fofa nesse vídeo infantil, no ritmo da música."
- "Cria do zero um vídeo ensinando uma receita, com narração e trilha."
- "Faz um anúncio de 30s do meu app com esses 3 prints."
- "Esse vídeo é horizontal: deixa vertical seguindo meu rosto, com texto atrás de mim."

Não sabe por onde começar? Diga só **"oi Velix"**.

## O que tem dentro

| Pasta | Conteúdo |
|---|---|
| `templates/robo/` | As telas do Velix: boas-vindas, diagnóstico, plano, entrega |
| `engine/` | Motor de animação próprio. Render paralelo com motion blur real, efeitos sonoros automáticos, transparência, 3D e Lottie |
| `templates/` | 11 modelos: explainer, legendas (viral, premium, infantil), podcast com motion, showreel, logo reveal, partículas 3D, lyric, app/UI, texto gigante. Mais exemplos completos (receita, reel com números) |
| `scripts/mv_edit.py` | Cortar pausas, vertical, zoom, compor, cor de cinema (8 looks), trilha com ducking, batidas da música, exportar (-14 LUFS), checagem de qualidade |
| `scripts/mv_visao.py` | IA local: reframe que segue o rosto, recorte da pessoa, texto atrás da pessoa |
| `scripts/transcrever.py` | Legenda palavra por palavra. Escolhe o motor sozinho: sherpa-onnx, faster-whisper ou .srt |
| `references/` | 12 guias: playbook viral, formatos, estilos, motion, legendas, edição, referências, conectores, podcast, legendas especiais, motion narrado, robô Velix |
| `assets/` | 8 famílias de fontes livres e 35 efeitos sonoros originais (uso comercial livre) |

## Licenças de terceiros (todas permitem uso comercial)

| Componente | Licença |
|---|---|
| Three.js, lottie-web | MIT |
| Fontes | SIL OFL 1.1 |
| Playwright | Apache-2.0 |
| MediaPipe | Apache-2.0 |
| sherpa-onnx | Apache-2.0 |
| Modelos Whisper (OpenAI), Silero VAD | MIT |
| FFmpeg | LGPL/GPL, instalado à parte |
| Motor, templates, scripts, telas e SFX | Originais MotionVelix |

Os vídeos de exemplo citados nos guias são demonstrações de formato. Edite apenas conteúdo seu ou com autorização.
