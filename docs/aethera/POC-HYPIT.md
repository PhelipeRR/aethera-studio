# Aethera — PoC isolada do Hypit no Windows (2026-11-09)

Autorizada pelo usuário em 2026-11-09. Executada numa pasta temporária fora do repositório e fora da pasta de dados
do app. Sem credenciais, sem provedores externos, sem envio de mídia. Tudo o que foi criado fora da pasta foi removido
ao final.

## Ambiente

Windows 11 Pro 10.0.26300, Node v24.17.0, `@hypit/hypit` **0.3.1** (a versão no npm; o GitHub já está em 0.3.2).

## Passos e resultados

| Passo | Comando | Resultado |
|---|---|---|
| Inspeção antes de instalar | `npm view @hypit/hypit` | Sem scripts de instalação no pacote principal; 113 pacotes no total; dois scripts de instalação em dependências conhecidas: `esbuild` (valida o binário) e `koffi` (seleciona o binário pré-compilado) |
| Instalação isolada | `npm install --ignore-scripts`, depois `npm rebuild esbuild koffi` | 11 s, 140 MB de `node_modules`; o `koffi` usou o binário pré-compilado `win32_x64` (sem compilador) |
| Versão | `hypit --version`, `hypit version --check` | `0.3.1`, "matches installed" |
| Projeto | `package.json` com `"hypit": { "project": true }` | Sem essa marca, o CLI recusa com mensagem clara |
| Runtime | `hypit runtime init`, `hypit runtime use` | Perfil local criado no projeto; "nenhum pacote instalado, nenhum serviço contatado" |
| Diagnóstico | `hypit doctor` | Funciona no Windows; apontou a falta do Chrome Headless Shell **win64** e o caminho esperado |
| Validação | `hypit check chat.svml` | "Source is valid", 11 saídas |
| Plano | `hypit plan chat.svrun` | Lista as 3 operações (render de áudio, rasterização HTML, mux), todas locais, e a pendência de preparo |
| Custo | `hypit pricing chat.svrun --json` | JSON `hypit.cli-pricing@1`: 3 pedidos, 3 sem cobrança, US$ 0 |
| Preparo | `hypit runtime up` | 11 s; baixou o Chrome Headless Shell 152 oficial (Chrome for Testing, Google) para `~/.cache/hypit` (272 MB) |
| Build | `hypit build chat.svrun --title poc --follow` | **Concluído em 13 s** (vídeo de 8 s, 540×960, 30 fps, 240 quadros); progresso por etapas e quadros no terminal |
| Recursos | amostragem de processos durante o build | Pico de **11 processos (Chrome headless + FFmpeg) e 849 MB** |
| Exportação | `hypit get <id> --output final.video --to output/final.mp4` | MP4 válido conferido com FFprobe: H.264 540×960 30 fps + AAC, **8,000 s**, 81 KB |
| Resultado | `.hypit/results/<data>/<build>/` | `result.json` (`hypit.build-result@1`, saídas tipadas), `execution.jsonl`, `files/`, `values/` |
| Estado legível por máquina | `hypit status <id> --json` | `hypit.cli-status@1` ("stable machine view") com `work.state` e `work.outcome` |
| Cancelamento | `hypit build` (sem `--follow`) e `hypit cancel <id>` | "cancellation requested"; `status` mostra `Outcome cancelled` |
| Códigos de saída | `status` de build inexistente, `check` de arquivo inexistente | `1` em erro, `0` em sucesso |
| Encerramento | `hypit runtime down`, `hypit programs down` | Nenhum processo do Hypit restante (Node, Chrome headless, FFmpeg) |
| Limpeza | remoção de `~/.cache/hypit` | Removido; `%LOCALAPPDATA%\Hypit` não chegou a ser criado. A pasta da PoC ficou só no diretório temporário da sessão |

## Conclusões

1. **O Hypit funciona no Windows** para render local (HTML + FFmpeg), sem provedores externos e sem compilador.
2. **A interface certa para o adaptador é o CLI**: tem saída JSON estável (`pricing --json`, `status --json`),
   resultado estruturado (`result.json`), códigos de saída confiáveis, cancelamento e encerramento limpo.
3. **Requisitos reais**: Node >= 22.15 do usuário (o Electron não é necessário); um projeto Hypit marcado em
   `package.json`; o preparo baixa o Chrome Headless Shell (272 MB) na primeira vez.
4. **Custo de recursos**: 849 MB e 11 processos num vídeo curto vertical; um vídeo longo ou 1080p vai pedir mais.
   Isso confirma a necessidade da fila com limite de concorrência (AET-08) e do monitoramento real.
5. **Atrito de autoria**: componentes de cena são pacotes TypeScript compilados (`tsc`), e o exemplo usa dependências
   `workspace:`. Um projeto independente exige trocar essas dependências por versões publicadas. O adaptador do
   Aethera deve gerar o projeto Hypit pronto (package.json, perfil de runtime e componentes compilados), sem pedir isso
   ao usuário.
6. **Não testado nesta PoC** (exigiria credenciais ou envio de dados): provedores externos (HypiHub, Seedance etc.),
   WhisperX/OpenCV locais (`uv`/Python), clonagem de vídeo de referência, Studio do Hypit.
