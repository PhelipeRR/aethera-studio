# Fase 50 (Singularity) — notas de migração, segurança e reversão

Lote 50.12. Cobre a trilha visual entregue: 50.02 (design system), 50.03 (tema e componentes), 50.04 (Void e marca),
50.05 (todas as telas), 50.06 (motor da Galáxia), 50.07 (Galáxia ligada à memória real e ao RAG), 50.08
(monitoramento real) e 50.11 (custo em repouso e acessibilidade). Paperclip (50.09/50.10), CORE e MOB viraram fases
próprias e não fazem parte desta entrega.

## O que muda para quem atualiza

| Área | Mudança | Dados afetados |
|---|---|---|
| Visual | Tema Singularity (petróleo + dourado, vidro), navegação por contexto, status do sistema fixo na barra lateral | nenhum |
| Mascote e marca | Neura vira **Void** na interface; logo e ícone do app passam a ser o Void sem olhos | nenhum. A palavra de ativação da voz continua "Neura" (decisão pendente do usuário) |
| Memória | Aba **Galáxia** substitui o Cérebro 3D como visualização padrão | nenhum. Só leitura das memórias e embeddings existentes |
| Monitoramento | Tela nova com CPU, GPU, RAM, disco e rede reais | `preferences.json` ganha `monitoring.intervalMs`; cache do probe em `%APPDATA%\NeuralBridge\monitoring\probe.json` |

**Sem migração de dados.** A Fase 50 não criou migração de banco, não alterou tabelas e não mexeu em segredos. Pela
decisão D-1, continuam iguais: `app.setName('NeuralBridge')` (pasta `%APPDATA%\NeuralBridge` e chave do
`safeStorage`), `appId` `com.neuralbridge.desktop`, `productName` do instalador, servidor MCP `neuralbridge`, formato de
exportação `neuralbridge-brain` e pacotes `@neuralbridge/*`. A troca de nome técnico tem plano próprio (M1–M4) em
`phase-50-rebrand-migration.md` e exige autorização separada.

## Revisão de segurança (superfícies novas)

| Superfície | Risco avaliado | Resultado |
|---|---|---|
| Processos do monitoramento (`typeperf`, `powershell.exe` do probe, `nvidia-smi`) | Execução de binário plantado via `PATH` ou pasta de trabalho | **Corrigido:** os três agora são iniciados por caminho absoluto em `%SystemRoot%\System32`. Sem `shell`, com `windowsHide`, `typeperf` e `nvidia-smi` sem stdin, probe com timeout de 30 s e saída limitada a 4 MiB |
| Cache do probe (`monitoring\probe.json`) | Arquivo na pasta de dados vira argumento do `typeperf` (ex.: `-o` grava arquivo, `-cf` lê configuração) e caminho do `statfs` | **Corrigido:** `sanitizeProbe` trata o cache como entrada não confiável. Só aceita contador que começa com `\`, sem aspas nem caracteres de controle, e só raízes de unidade `X:\`. Cache inválido é descartado e o probe roda de novo |
| Script do probe | Injeção pelo ambiente | Script constante; a única entrada é `NB_PROBE_COUNTERS`, JSON gerado pelo próprio app |
| IPC `monitoring:snapshot` / `monitoring:configure` | Entrada do renderer | Contratos zod `strictObject`, intervalo restrito à lista permitida, remetente confiável obrigatório |
| IPC `brain:galaxy` | Vazamento de dados | Sem entrada, somente leitura, saída validada por zod, só para o renderer confiável |
| Recuperações na Galáxia (log de acesso MCP, `rag_context`) | Texto de memória como HTML | Renderizado como texto pelo React; nenhum `dangerouslySetInnerHTML` novo |
| Descrição de item do Azure DevOps (anterior à Fase 50, achado na varredura) | HTML externo em `innerHTML` de elemento do documento vivo | Já mitigado pela CSP de produção (`script-src 'self'`, `img-src 'self' data:`). **Endurecido:** agora o HTML é lido com `DOMParser`, um documento inerte |
| Arte do Void | Recurso externo | Arquivo `.webp` local, empacotado; nada é baixado |

## Como reverter

1. **Só a visualização da memória:** em Memória → Configurações, escolha "Cérebro 3D anterior". Vale na hora, sem
   reiniciar; a rota da Galáxia continua acessível por link direto.
2. **Versão inteira:** instale o instalador da versão anterior por cima. Como não há migração de banco, os dados abrem
   na versão antiga. A chave `monitoring` do `preferences.json` é ignorada pela versão antiga e removida na próxima
   gravação. A pasta `monitoring\` pode ficar ou ser apagada; ela é recriada se o app novo voltar.
3. **Código:** cada lote é um commit próprio na branch `feat/neura-assistant`, então dá para reverter um lote isolado com
   `git revert <commit>`, sem reescrever o histórico.

## Validação do lote

Os resultados de E2E, empacotamento e smoke test do app empacotado ficam em `docs/STATUS.md`, na seção do lote 50.12.
