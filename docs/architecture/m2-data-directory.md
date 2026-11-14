# M2 — Migração reversível da pasta de dados

**Status:** implementado e validado em 2026-11-10 (unidade, Electron, safeStorage real e executável empacotado). Upgrade instalado entre versões fica com M1, que mexe no instalador.

## Objetivo

Permitir que o Electron, o Singularity Core standalone e o servidor MCP compartilhem
`%APPDATA%\Singularity` sem remover ou alterar a pasta histórica
`%APPDATA%\NeuralBridge`.

## Comportamento implementado

1. `resolveDataDir()` respeita `NB_DATA_DIR` sem executar migração.
2. Sem override, se `Singularity` já existe, ele é usado; se somente `NeuralBridge`
   existe, uma cópia é criada.
3. A cópia ocorre em um diretório temporário no mesmo volume. Os hashes SHA-256 de
   todos os arquivos são comparados antes de o diretório ser renomeado para o destino.
4. `migrated-from.json` é gravado somente depois da verificação e antes do rename.
5. A origem nunca é movida, apagada ou sobrescrita. Se qualquer etapa falhar, o
   staging é removido quando possível e o processo continua usando a origem legada.
6. Uma segunda inicialização é no-op quando o destino já existe.
7. **Banco em uso adia a cópia.** Se outro processo (servidor MCP aberto por um cliente, Core standalone de uma versão
   anterior) segura um banco SQLite da árvore legada, a cópia não acontece: o processo usa a origem nesta vez e a cópia
   ocorre num início seguinte, depois que o banco for fechado. Assim nenhum processo continua gravando na pasta antiga
   depois da troca. A detecção renomeia o `-shm` e o devolve: no Windows o SQLite abre esse arquivo sem
   compartilhamento de exclusão, então o rename falha exatamente enquanto o banco está aberto. Arquivos `-wal`/`-shm`
   deixados após um fechamento limpo (o SQLite e o Chromium deixam) não bloqueiam a migração. O `-shm` é só um índice
   que o SQLite reconstrói, então a sonda não pode danificar dados.
8. **Corrida entre processos.** Se dois processos migram ao mesmo tempo, o que perde o rename adota a cópia verificada
   do vencedor (`migrated-from.json` presente) em vez de voltar para a pasta antiga; todos ficam no mesmo diretório.
9. **Disco cheio.** Uma falha no meio da cópia remove o staging, mantém a origem intacta e o próximo início tenta de novo.

## Compatibilidade e limites

- O arquivo Chromium `Local State` é copiado byte a byte; `m2-safe-storage.spec.ts` grava um segredo com o
  `safeStorage` real do Electron na pasta antiga e o lê de volta na pasta nova.
- Upgrade com instalador entre versões depende de M1 (identidade do instalador) e é testado lá.
- A pasta antiga permanece disponível para rollback. O rollback consiste em fechar a
  versão migrada, reinstalar a versão anterior e continuar usando `NeuralBridge`.

## Evidência local

- `packages/shared/test/paths-migration.test.ts` (6): cópia única e verificada, banco aberto por conexão SQLite real
  adia e migra depois, sobras de fechamento limpo não bloqueiam, corrida adota a cópia do vencedor, disco cheio remove
  o staging e preserva a origem, destino impossível volta à origem.
- `tests/e2e/m2-data-migration.spec.ts`: Electron real; com um banco WAL aberto por outro processo fica na pasta antiga,
  depois de fechado migra com os dados e mantém a origem para rollback.
- `tests/e2e/m2-safe-storage.spec.ts`: segredo do `safeStorage` real legível após a cópia.
- `tests/e2e/m2-data-migration-packaged.spec.ts`: o executável empacotado migra antes de usar `userData`.
- Upgrade instalado 0.1.58 → 0.1.59 (M1) e executável empacotado com `productName: Singularity`: os dados migram antes
  de o Electron usar `userData`; o nome novo não cria uma pasta vazia antes da migração.
- `npx tsc -p packages/shared`: aprovado.
- ESLint dos arquivos alterados: aprovado.
