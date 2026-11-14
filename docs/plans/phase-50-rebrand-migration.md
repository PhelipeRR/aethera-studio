# Fase 50 — Lote 50.04: rebranding visível e plano de migração técnica

**Status:** marca visível implementada em 2026-11-08. M3 foi implementada e M2 tem
implementação local validada, ainda sem commit; os testes de inicialização real do Electron
e do executável empacotado passaram em 2026-11-10, incluindo cópia de SQLite em WAL aberto.
A evidência de descriptografia real pelo safeStorage após a cópia passou em perfil temporário no Windows; o upgrade
entre versões do instalador ainda continua pendente. Cada etapa
continua exigindo autorização própria.

## 1. O que mudou agora (marca visível)

| Superfície | Antes | Agora |
|---|---|---|
| Cabeçalho do app | símbolo da ponte + "NeuralBridge / Intelligent Workspace" | horizonte de eventos + "SINGULARITY / AI ORCHESTRATOR" |
| Título da janela e do documento | NeuralBridge | Singularity |
| Bandeja do Windows | "Abrir/Ocultar NeuralBridge", dica "NeuralBridge" | "Abrir/Ocultar Singularity", "Singularity" |
| Companion HUD | "NeuralBridge Companion" | "Singularity Companion" |
| Textos da interface (27 arquivos) | "o NeuralBridge …" | "o Singularity …" |
| Exportação de memórias | pasta `NeuralBridge-memorias-*`, filtro "Exportação do NeuralBridge" | `Singularity-memorias-*`, "Exportação do Singularity" (o formato do arquivo é o mesmo; exportações antigas continuam importáveis) |
| Ícone do app e do instalador (`apps/desktop/build/icon.*`, `scripts/generate-icon.mjs`) | ponte com dois nós | horizonte de eventos com anel dourado |

Comentários de código e identificadores (`NeuralBridgeMascot`, `NeuralBridgeApi`, `window.neuralbridge`, pacotes
`@neuralbridge/*`) **não** mudaram: não são visíveis e renomeá-los só traria risco.

## 2. O que continua com o nome antigo, de propósito

| Identificador | Valor | Por que não mudou |
|---|---|---|
| Nome interno do app (`app.setName`) | `NeuralBridge` | Define `%APPDATA%\NeuralBridge`, onde ficam o banco, as preferências, os backups, os modelos, as extensões e a chave do `safeStorage`. Mudar abre uma pasta vazia e perde os segredos. |
| AppUserModelId / `appId` | `com.neuralbridge.desktop` | Identifica a instalação, os atalhos e as notificações. Mudar cria uma segunda instalação lado a lado. |
| Instalador (`productName`, nome do `.exe`) | `NeuralBridge`, `NeuralBridge-Setup-*` | Define a pasta de instalação e o desinstalador. |
| Servidor MCP | `neuralbridge` | Já registrado no Claude Code e no Codex de quem usa o app. |
| Variáveis de ambiente | `NB_*` | Neutras; podem ficar para sempre. |
| Pacotes internos | `@neuralbridge/*` | Sem valor visível; custo alto. |
| URL interna | `https://local.neuralbridge/...` | Já gravada em dados do Velix. |

## 3. Plano de migração técnica (futuro, por etapas)

Ordem pensada para que cada etapa seja reversível sozinha. Nenhuma começa sem autorização.

### M1 — Instalador com nome novo, mesma identidade
- `productName: Singularity`, `artifactName: Singularity-Setup-*`, atalho "Singularity". O **`appId` continua**
  `com.neuralbridge.desktop`, e o NSIS reconhece a instalação existente pelo GUID derivado dele.
- **Risco:** a pasta de instalação padrão muda para `Program Files\Singularity`, e a atualização pode instalar ao
  lado. **Mitigação:** `nsis.include` com um script que lê `InstallLocation` da chave do desinstalador e reaproveita
  o caminho; remover o atalho antigo "NeuralBridge".
- **Teste:** instalar a 0.1.x antiga, atualizar e verificar uma única entrada em "Aplicativos", com os mesmos dados.
- **Rollback:** reinstalar a versão anterior; os dados não mudam de lugar.
- **IMPLEMENTADO em 2026-11-10 (0.1.59).** O script NSIS extra não foi necessário: o instalador do electron-builder já lê
  `InstallLocation` da chave `HKCU\Software\<GUID do appId>` e o desinstalador da versão antiga remove os próprios
  atalhos. O executável continua `NeuralBridge.exe` (`executableName`) porque a tarefa de logon do Core, os atalhos e
  regras de firewall apontam para ele. Teste real: 0.1.58 → 0.1.59 manteve uma entrada ("Singularity 0.1.59", mesma
  chave), a mesma pasta e trocou os atalhos; a reinstalação da 0.1.58 voltou ao estado inicial.

### M2 — Pasta de dados `%APPDATA%\Singularity`
- **IMPLEMENTAÇÃO LOCAL:** na inicialização, antes de abrir o banco: se `Singularity` não existe e `NeuralBridge` existe, **copiar** (não mover) a
  pasta inteira, **incluindo o arquivo `Local State`** (chave do `safeStorage`), verificar os hashes, gravar
  `migrated-from.json` e só então usar a nova. A cópia usa staging e rename atômico; a pasta antiga fica intacta por pelo menos uma versão.
- O servidor MCP standalone (`resolveDataDir`) passa a procurar `Singularity` primeiro e `NeuralBridge` depois, para os
  clientes já registrados continuarem funcionando durante a transição.
- **Evidência atual:** cópia, hash, preservação da origem e no-op da segunda inicialização, teste de inicialização real do
  Electron antes da criação do userData e smoke empacotado, incluindo SQLite em WAL aberto (E2E 2/2).
- **Evidência adicional:** um segredo produzido por `safeStorage.encryptString` no perfil legado foi descriptografado
  com `safeStorage.decryptString` após a cópia para `Singularity` (`tests/e2e/m2-safe-storage.spec.ts`, 1/1).
- **Rollback de destino indisponível:** `migrateLegacyDataDir` foi exercitado com um destino bloqueado por arquivo;
  retornou ao diretório legado, preservou a origem e não deixou uma árvore parcial (`paths-migration.test.ts`, 2/2).
- **Pendências:** falta de espaço e teste de instalação/upgrade entre versões. O instalador atual `0.1.58` foi
  instalado com sucesso em diretório temporário; o artefato antigo local `0.1.28` encerra com código 2 antes de
  criar a instalação descartável, portanto não houve evidência de upgrade entre versões nesta máquina.
- **Rollback:** a versão anterior continua lendo `NeuralBridge`, que não foi alterada.

### M3 — Nome do servidor MCP `singularity`
- **CONCLUÍDO em 2026-11-10:** a tela de MCP registra `singularity` ao lado de `neuralbridge`, mantendo o antigo intacto e fazendo backup da configuração.
- **Rollback:** remover somente o alias `singularity`; `neuralbridge` permanece disponível.

### M4 — `appId` (`com.singularity.desktop`)
- Só se houver motivo forte (loja, assinatura). Exige migração de atalhos, notificações e associação de arquivos, e
  provavelmente uma desinstalação assistida da identidade antiga. **Recomendação:** não fazer.
- **REJEITADA em 2026-11-10.** M1 já entrega o nome visível; trocar o `appId` só traria custo e risco (segunda entrada
  em "Aplicativos", notificações e atalhos órfãos). Reabrir apenas se uma loja ou certificado exigir.

### Fora do escopo
Renomear pacotes `@neuralbridge/*`, variáveis `NB_*` e a URL interna: sem ganho para o usuário.

## 4. Checklist de migração (para quando M1–M3 forem autorizados)

- [ ] Backup verificado antes de qualquer etapa (o app já tem backup automático do cérebro).
- [x] Upgrade a partir da última versão instalada (0.1.58 → 0.1.59 nesta máquina, sem abrir o app; dados da migração
  cobertos pelos testes de M2 com Electron e executável empacotado).
- [x] Segredos (`*.bin` do `safeStorage`) legíveis depois de M2 (`m2-safe-storage.spec.ts`).
- [ ] Claude Code e Codex continuam usando a memória depois de M2 e M3.
- [x] Uma única entrada em "Aplicativos instalados" depois de M1.
- [x] Rollback de cada etapa exercitado (M1 reinstalando 0.1.58; M2 pela origem intacta; M3 pela remoção do alias).
