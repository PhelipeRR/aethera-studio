# Distribuição Windows

## Gerar o instalador

No PowerShell, na raiz do repositório:

```powershell
npm run dist:win
```

O artefato NSIS x64 é criado em `dist/Singularity-Setup-<versão>-x64.exe` (M1: nome visível Singularity; o
executável instalado continua `NeuralBridge.exe` e o `appId` continua `com.neuralbridge.desktop`).
O comando gera `apps/desktop/build/icon.ico` multi-resolução a partir da marca,
compila o bundle e executa o electron-builder. O mesmo `.ico` é usado pela janela,
barra de tarefas, executável, atalhos e instalador.

O log do electron-builder confirmou a incorporação do ícone (não houve uso do
ícone padrão). A confirmação visual final do ícone na barra de tarefas e nos
atalhos deve ser feita manualmente no Windows Explorer após instalar o NSIS.

## Instalação e dados

O instalador é assistido (`oneClick: false`) e permite escolher a pasta. Uma atualização de uma versão anterior
(nome "NeuralBridge") encontra a instalação existente pelo GUID do `appId`, instala na mesma pasta, troca o atalho
"NeuralBridge" por "Singularity" e mantém uma única entrada em "Aplicativos instalados". Os dados ficam em
`%APPDATA%\Singularity`, copiados uma vez de `%APPDATA%\NeuralBridge` (M2, que preserva a origem); o desinstalador
não remove os dados (`deleteAppDataOnUninstall: false`). A aplicação cria/usa logs
locais conforme os componentes do Electron e preserva os backups e o banco nesse
diretório.

## MCP

O bundle contém o `mcp-server.js`, as migrations e as dependências necessárias
para execução standalone. A página MCP mostra os comandos oficiais de registro
para Claude Code e Codex; o registro é confirmado pelo usuário e cria backup da
configuração anterior antes de reparar uma entrada desatualizada.

## Limitações de distribuição

O build local não possui certificado de assinatura de código. O instalador deve
ser assinado no pipeline de distribuição antes de publicação. Os testes que
exigem CLIs reais autenticadas permanecem dependentes do ambiente do usuário.
