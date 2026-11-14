# Aethera — Estratégia de renomeação (AET-02 e depois)

## O que o AET-02 mudou (só o que o usuário vê)

| Onde | Antes | Depois |
|---|---|---|
| Menu e rota `/video` | "Velix" · "Editor MotionVelix: edite takes e crie motion com os agentes." | "Aethera" · "AI Cinematic Studio: produza, edite e componha vídeos com os agentes." |
| Cabeçalho da tela | "Singularity Studio" / "Velix" | "AI Cinematic Studio" / "Aethera" |
| Regiões e rótulos acessíveis | Canal, Descoberta, Ideias, Motion, Produção, Fluxo, Áreas, "Novo vídeo com o Velix", "Vídeos do Velix" | Os mesmos com "Aethera" |
| Botões e avisos | "Começar com o Velix", "O Velix prepara…", "O Velix roda node, python e ffmpeg…", "Velix não baixa vídeos…" | Com "Aethera" |
| Extensão indisponível | "Velix indisponível", "A extensão Velix não está instalada…", carregando | Com "Aethera" |
| Tour guiado | "Produza com o Velix", "etapas revisáveis do Velix" | Com "Aethera" |
| Tela Extensões | nome gravado no manifesto ("Velix") | "Aethera" por apelido de exibição pelo id `velix` (`app/extension-names.ts`), **sem migrar o banco** |
| Manifesto do pacote | `name: 'Velix'` | `name: 'Aethera'` (o id `velix` fica) |
| Mensagens de erro | "O Velix usa o Claude Code…", "template do Velix desconhecido", "derivados Velix indisponíveis" | Com "Aethera" |
| Erro do kit | "O Velix falhou (…)" | "O MotionVelix falhou (…)" — é o kit externo, que mantém o nome (decisão do usuário) |
| Templates de Motion e skills internas | "Velix Base", "Velix Editorial", "Velix Motion Composition", "Velix Channel Optimizer" | Com "Aethera" (os ids `velix-base`, `velix-editorial`, `neuralbridge:velix-*` ficam) |
| Brief enviado ao agente | "Velix, detalhes do projeto — …" | "Aethera, detalhes do projeto — …" |
| README | seção e menções | "Aethera — AI Cinematic Studio (antes Velix)" com nota de compatibilidade |

## O que **não** mudou (de propósito)

Extensão `velix`, rota `/video`, 151 canais IPC `video:*`, namespace `window.neuralbridge.video`, 33 tabelas
`video_*`/`velix_*`, preferências `velixProjectId`/`velixAgent`, pastas `producoes/<runId>/…`, segredos
`velix-channel-oauth.bin`/`gemini-api-key.bin`, variáveis `NB_VELIX_DIR` e afins, ids de templates e skills, nomes de
arquivos e componentes do código, o kit MotionVelix. Por isso **projetos e produções criados no Velix abrem normalmente**:
nenhum dado foi tocado.

## Migração técnica futura (separada, reversível, só com autorização)

Mesmo padrão do plano M1–M4 do rebranding Singularity:

1. **Aliases**: aceitar `aethera` como apelido de `velix` (extensão, rota `/aethera` redirecionando para `/video`,
   variáveis `NB_AETHERA_*` com fallback para `NB_VELIX_*`), sem remover nada.
2. **Leitura dupla**: novos nomes primeiro, antigos como fallback, com telemetria local de uso.
3. **Migração aditiva**: só se houver ganho real (por exemplo, renomear o id da extensão). Nada destrutivo; o antigo
   continua lido por pelo menos uma versão.
4. **Remoção**: em versão posterior, com aprovação explícita e plano de volta.

Recomendação atual: **não fazer** a migração técnica agora. Ela não traz benefício visível e cria risco em 911
referências e nos dados de produções.
