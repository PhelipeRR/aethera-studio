# Fase 30 — NeuralBridge Video Studio

## 1. Objetivo

Permitir que Claude Code e Codex criem e editem vídeos por comandos no Chat, com timeline complementar e renderização local controlada.

## 2. Estado atual

O projeto já usa Electron, React, TypeScript, Skills, permissões, TaskEngine e possui experiência anterior com Remotion; não existe Studio integrado.

## 3. Reutilização

Chat/TaskEngine, Projects, Skills Manager, permissões, token analytics, armazenamento de artefatos, Brain/RAG e componentes React.

## 4. Escopo

Projetos de vídeo, biblioteca de mídia, cenas Remotion/React/HTML/CSS/SVG, FFmpeg, motion graphics, imagens/fotografias/infográficos, legendas, narração, trilhas, efeitos, transições, preview, timeline, cancelamento e exportação MP4.

## 5. Arquitetura

O Chat gera/edita um projeto versionado; renderizador isolado executa composição validada em processo separado. Timeline é uma visão dos artefatos, não uma segunda engine. IA generativa externa não é obrigatória.

## 6. Componentes

Novo pacote de domínio Video, workspace/artifacts, TaskEngine, Skills, IPC, renderer Studio, FFmpeg/Remotion e Brain.

## 7. Dados

Migração para video_projects, assets, compositions, render_jobs e versões somente após definir o formato; arquivos grandes ficam fora do SQLite, com hashes e metadados no banco.

## 8. Fluxo

Criar projeto → importar/validar mídia → comando no Chat → gerar composição → preview → aprovar render → executar isolado → cancelar/retomar → exportar MP4.

## 9. Segurança

Raiz autorizada, traversal/symlink bloqueados, tipos/tamanho validados, sem execução de scripts de mídia, codecs e comandos allowlisted, nenhum upload externo implícito.

## 10. Desempenho

Workers/processos isolados, limites de CPU/memória/duração, cache por hash, filas bounded, preview de baixa resolução e limpeza de temporários.

## 11. Dependências

TaskEngine, Skills, permissões, armazenamento de artefatos, Electron e ferramentas locais Remotion/FFmpeg. Pode avançar independentemente das Fases 25–29 se essas dependências estiverem estáveis.

## 12. Etapas

1. Formato de projeto. 2. biblioteca/validação. 3. composição e preview. 4. render isolado. 5. áudio/legendas. 6. UI/timeline. 7. skills/agentes. 8. exportação. 9. testes.

## 13. Testes

Fixtures de cenas e mídia; render determinístico, cancelamento, falha, limites, áudio sincronizado, legendas, traversal, isolamento e E2E Electron.

## 14. Aceite

Uma instrução no Chat cria e edita uma composição real; preview funciona; render MP4 reproduzível é cancelável; nenhum arquivo sai da raiz; agentes e skills são auditáveis.

## 15. Riscos

Licenças, codecs, arquivos grandes, render lento e comandos arbitrários. Mitigar com dependências locais verificadas, limites e isolamento.

## 16. Fora do escopo

Serviço de vídeo em nuvem obrigatório, geração proprietária de mídia, publicação automática e edição profissional não destrutiva completa.

## 17. Entregáveis

Domínio/persistência, render worker, Studio, integração Chat/Skills/Brain, IPC, testes e documentação de licenças.

## 18. Status

**SUBSTITUÍDA PELO VELIX (2026-10-30).** O render do Studio apenas convertia o primeiro asset com FFmpeg e ignorava cenas e legendas. A rota `/video` passou a ser a página Velix.

## 19. Velix (MotionVelix)

- **Kit fora do repositório e do instalador:** cada usuário instala a skill em `~/.claude/skills/motionvelix` (ou aponta `NB_VELIX_DIR`). O app não redistribui motor, templates nem SFX, porque nem o kit nem o Guia do Velix autorizam a redistribuição: o LEIA-ME só lista as licenças de terceiros, e o guia é descrito como bônus exclusivo para clientes.
- **Dois caminhos:** o formulário nativo abre uma tarefa no Chat com a skill `motionvelix`; o render direto usa `packages/workspace/src/velix.ts`, com seis modelos allowlisted que geram MP4. Camadas com alfa e edição de takes ficam com o agente.
- **Telas nativas:** as telas `templates/robo/` não são embutidas. Elas dependem do CSS e do JS do host Claude, e embuti-las exigiria afrouxar `frame-src 'none'`. Plano e ajustes acontecem em texto na conversa.
- **Exceção à seção 9:** o render executa `render.mjs` do kit em Node, e ele abre o Chromium com `--disable-web-security`. A mitigação é aceitar só modelos allowlisted, sem shell, com saída, áudio e dados confinados à raiz, um render por vez e cancelamento da árvore de processos. O conteúdo de uma cena ainda pode ler arquivos locais durante o render.
- **Importar vídeo:** `importVideo` em `velix.ts` chama `python -m yt_dlp` (ou `NB_PYTHON`) instalado pelo usuário. O script e o guia do Velix Downloader não entram no repositório. Aceita um link http(s) por vez, sem playlist, salva em `imports/` na raiz e divide a fila e o cancelamento com os renders. A interface e o IPC exigem confirmação explícita do direito de uso, porque os termos do YouTube restringem downloads fora do app oficial. Revisar este recurso antes de distribuir o NeuralBridge a terceiros.
- **Dados:** `video_render_jobs` continua em uso. As tabelas `video_projects`, `video_compositions` e `video_assets` ficam sem uso, sem migração destrutiva.
- **Pré-requisitos:** Node, FFmpeg, Playwright e Chromium do kit. No Windows, `scripts/setup.py` não instala o Playwright, porque chama `npm` sem shell, e a versão 1.49.1 que ele fixa travou ao extrair o Chromium no Node 24. Instalar com `npm i --prefix ~/.motionvelix playwright@1.64.0` e `playwright install chromium`. `render.mjs` também não acha esse Playwright no Windows, porque importa um caminho absoluto; o serviço cria a junction `node_modules` no kit (`linkVelixDependencies`) sem alterar o kit. Tarefas no Chat precisam de `node`, `python` e `ffmpeg` liberados no acesso do projeto.
