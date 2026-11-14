# Aethera — Arquitetura proposta (AET-01)

Status: proposta, aguardando aprovação. Nada implementado.

## 1. Princípio

O Aethera **evolui** o Velix; ele não é reescrito. A identidade visível muda, o domínio continua o mesmo, e o Hypit
entra como **mais um motor de render**, atrás de uma interface. O Singularity continua o único orquestrador de agentes.

```
 Aethera (aba do app, extensão "velix" → rótulo Aethera)
   ProductionRunService (existente) — etapas briefing … export; cada etapa de agente = tarefa do TaskEngine (lease)
     etapa "composition"/"render" → VideoEngineRegistry
        ├─ RemotionEngine  (existente: motion/render-worker.mjs, composições Remotion, FFmpeg empacotado)
        ├─ MotionVelixKitEngine (existente: kit do usuário, engine/render.mjs)
        └─ HypitEngine     (novo: CLI do Hypit instalada pelo usuário, processo isolado)
     "Auto" = escolha por capacidades declaradas + requisitos da produção (formato, duração, legendas, B-roll…)
```

## 2. Contrato de motor (AET-04)

```ts
interface VideoEngine {
  id: 'remotion' | 'motionvelix-kit' | 'hypit';
  detect(): Promise<EngineAvailability>;            // instalado? versão? dependências ausentes (com mensagem acionável)
  capabilities(): EngineCapabilities;               // formatos, proporções, legendas, transições, B-roll, prévia, edição
  validate(project: AetheraProject): ValidationReport;
  estimate?(plan: EnginePlan): Promise<CostEstimate>;      // Hypit: `hypit pricing --json`
  prepare(project, signal): Promise<EnginePlan>;           // recursos e composição específica do motor
  preview?(plan, signal): Promise<PreviewArtifact>;
  render(plan, sink: ProgressSink, signal): Promise<RenderResult>;   // progresso, cancelamento (AbortSignal), artefatos
  export(result, target): Promise<ExportedFile>;
}
```

- Erros com categoria (`dependency_missing`, `invalid_project`, `provider_failed`, `cancelled`, `timeout`, `internal`).
- Artefatos registrados em `velix_production_artifacts` (já existe), com o motor de origem.
- **Cada produção guarda o motor com que foi criada** (coluna aditiva `engine`, padrão `remotion` para as
  existentes). Reabrir uma produção antiga usa o motor original.

## 3. Modelo de projeto Aethera

Um modelo próprio, neutro, construído sobre o que já existe (storyboard, timeline, narração, sync, composição):
cenas com duração, trilhas (vídeo, áudio, narração, legenda), recursos com origem e direitos, estilo, formato
(1920×1080, 1080×1920, 1080×1080). Cada motor recebe uma **projeção** desse modelo e devolve metadados próprios
(`engineMetadata`), sem que o modelo dependa do formato interno de Remotion ou SVML. Não há conversão bidirecional
prometida: um workflow Hypit é editado no Studio do Hypit ou reexecutado; a timeline do Aethera mostra o que o Hypit
expõe no `result.json`.

## 4. Adaptador Hypit (AET-05)

- **Interface**: a CLI oficial (`hypit`), por caminho absoluto detectado, sem shell, com argumentos fixos montados pelo
  adaptador. É a interface documentada e estável o bastante. O SDK não está documentado e por isso não é usado.
- **Fluxo**: `doctor` → `check` → `plan` → `pricing --json` (mostra o custo) → consentimento → `build --title … --follow`
  com `--project` dentro da pasta da produção e `--asset-root` só nas pastas autorizadas → `status --watch` para
  progresso → `get --to` para exportar → `inspect` em falhas. Cancelamento: `hypit cancel <id>`.
- **Isolamento**: projeto Hypit em `producoes/<runId>/hypit/`, resultados em `.hypit/` dentro dele; nenhum arquivo do
  app é tocado; variáveis de credencial nunca vão para log.
- **Privacidade**: provedores externos desligados por padrão; antes de qualquer envio, a tela mostra quais mídias
  saem e para qual serviço, e pede autorização.
- **Licença**: o app não empacota o Hypit; mostra "Hypit" e a atribuição nos resultados; não expõe o Hypit a terceiros.
- **Indisponível**: o motor aparece como indisponível, com o motivo (não instalado, Node antigo, Windows sem
  suporte, `doctor` falhou); nada é simulado.

## 5. Integração com o Singularity

- O Aethera é dono da produção audiovisual; o Singularity é dono da orquestração de agentes (`TaskEngine`, lease).
- Etapas de agente continuam sendo tarefas do `TaskEngine`; o Worker do Hypit é um detalhe interno do motor, nunca
  um segundo orquestrador de agentes.
- Futuro (fora desta frente): rotas `/api/v1/productions…` no Core, com os mesmos princípios do CORE-02 (idempotência,
  executor único, eventos). Nenhuma mudança no Singularity nesta frente.

## 6. Renomeação técnica (separada e reversível)

AET-02 muda só textos visíveis. Identificadores internos (`velix_*`, `video:*`, extensão `velix`, `/video`,
`velixProjectId`, `NB_VELIX_DIR`, `velix-channel-oauth.bin`) ficam. Uma eventual migração técnica segue o padrão do
plano M1–M4 do rebranding Singularity: aliases primeiro, leitura dupla, migração aditiva, remoção só em versão
posterior com aprovação.
