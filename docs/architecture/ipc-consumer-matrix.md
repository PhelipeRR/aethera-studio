# IPC consumer matrix

Audit date: 2026-11-06. No channel was removed or changed. Updated 2026-11-08 (see below).

## Consolidation update (2026-11-08, Task 2.2)

- **Capability inventory.** `packages/shared/src/ipc-capabilities.ts` assigns each of the 397 channel
  prefixes to one capability (system, work, projects, knowledge, skills, integrations, extensions,
  neura, velix) with its product area, tier and allowed preload namespaces.
  `packages/shared/test/ipc-capabilities.test.ts` and
  `apps/desktop/test/preload-capabilities.test.ts` fail when a channel has no capability or is exposed
  from another capability's namespace.
- **Azure DevOps regrouped.** Its 20 methods were exposed under the Velix `video` facade; they now
  live in `window.neuralbridge.azureDevOps`. Channel names, contracts and handlers are unchanged.
- **No raw provider payload.** `azure-devops:write:execute` returned the full TFS response
  (`z.unknown()`), including identities and links. The client now returns only normalized fields and
  the contract is closed. Loosely typed outputs are allowed only where `IPC_OPEN_OUTPUTS` documents
  app-owned data. `video:channel:profile.brandingSettings` stays open on purpose: it is the channel
  branding the user edits as JSON, with no credential.
- **Credentials.** No output field is named like a credential, except the main-issued, short-lived Git
  capability grant (`projects:git:authorize*.token`). Secrets enter from the renderer only on
  `IPC_SECRET_INGRESS` channels (TFS PAT, Gemini key). Both rules are tests.
- **Unused preload methods (not removed).** A reference scan found 13 preload methods with no renderer
  or E2E consumer: `skills.installPreview`, `skills.installStatus`, `tasks.swarmPlan`,
  `companion.getSession`, `neura.spotifyCommand`, `workflows.automationEvents`,
  `video.narrationTimeline`, `video.discoveryClips`, `video.clipCancel`, `video.channelPublish`,
  `video.collageList`, `video.channelPublishResume`, `azureDevOps.azureDevOpsWorkItemAttachment`.
  The deletion policy requires a replacement or an explicit retirement decision, and most belong to
  the frozen Velix/Neura extensions, so they stay as removal candidates for a product decision.

## Completeness result

`packages/shared/src/channels.ts` declares 393 invoke channels. The same 393
channels have entries in `packages/shared/src/ipc.ts`, references in the
preload facade, and main-process registration references. Ordinary registrations
use `registerIpcHandler` from `apps/desktop/src/main/ipc/handle.ts`; Companion's
five subscription/query channels use `registerCompanionIpcHandlers`, which
explicitly calls `parseIpcInput` and `parseIpcOutput`.

No declared invoke channel was proven to be without a main handler, preload
facade method, or contract. Renderer use is indirect by design (`window.neuralbridge`),
so absence of a literal channel name in a screen is not evidence of dead IPC.
The 11 `IpcEvent` entries are push events, not invoke channels, and are wired
through preload listeners where applicable.

## Domain matrix

| Domain / declared count | Contract | Main handler | Preload facade | Renderer consumers / routes | Test evidence | Risk note |
|---|---:|---|---|---|---|---|
| app 3, theme 2, semantic 3 | `ipc.ts` | `main/index.ts` | `app`, `theme`, `semantic` | Dashboard, Settings, startup state | desktop/main and E2E coverage | Low; composition-root dependency |
| mcp 4, agents 1 | yes | `main/index.ts` | `mcp`, `agents` | MCP and Agents pages | MCP/agent tests and E2E | Low/medium; provider availability is environmental |
| skills 29 | yes | `main/index.ts` + workspace skill services | `skills`, `skillsStudio` | Skills page, Chat skill selection | workspace skill tests, UI tests | Medium; install lifecycle has many states |
| extensions 7 | yes | `main/index.ts` + orchestrator installer/registry | `extensions` | Extensions page and extension-gated Velix route | extension unit/integration/E2E | Medium; lifecycle is experimental and registry external |
| history-sync 4, imported conversations 1 | yes | `main/index.ts` | `historySync`, `importedConversations` | Brain/history surfaces | Brain history tests | Medium; startup import is asynchronous |
| projects 49 | yes | `main/index.ts` + `git-ipc-handlers.ts` | `projects` | Projects, Git Intelligence, onboarding | workspace/project/Git tests and E2E | High; writes use short-lived authorization tokens |
| brain 26 | yes | `main/index.ts` + brain admin service | `brain` | Memory, Brain 3D, Learning, Settings | Brain/shared/desktop tests and E2E | Medium; database and embedding availability |
| tasks 23, analytics 3 | yes | `main/index.ts` + task service | `tasks`, `analytics` | Chat, Runs, Mission Control, Analytics | orchestrator/desktop/E2E | High; streaming events and task lifecycle |
| companion 14 | yes | `companion-ipc.ts` plus event pushes | `companion` | HUD, companion controls, Spotify companion | companion tests/E2E | Medium; lifecycle cleanup tied to window destruction |
| spotify 8, neura 20 | yes | `main/index.ts` + extracted Neura/Spotify modules | `spotify`, `neura` | Companion and Neura panels | Neura/Spotify tests/E2E | High; credentials are main-process state |
| workflows 26 | yes | `main/index.ts` + workflow service | `workflows` | Workflows builder and Mission Control | workflow tests/E2E | High; automation and approval state |
| video 150 | yes | `main/index.ts` + extracted channel/production modules | `video` | Velix route and video feature tree | workspace/orchestrator/video E2E | Highest payload and composition coupling |
| azure-devops 20 | yes | `main/index.ts` + Azure client/credential store | `azureDevOps` | Azure/TFS page and settings | client/desktop/E2E fixture tests | High; external auth and write approval |

## Validation and security observations

- `registerIpcHandler` validates the trusted sender URL before parsing input;
  the shared contract then parses both input and output. Companion follows the
  same policy in its specialized registration function.
- No persistent credential value is returned to the renderer in the inspected
  status flows: PAT status, OAuth status and Gemini key status return configured
  or metadata states. However, secret entry still crosses the renderer-to-main
  boundary for one-time writes/imports (`azureDevOpsCredentialSave`,
  `videoCollageKeySave`, and client-secret import UI). This is an explicit P1
  threat boundary, not evidence that secrets are stored in the renderer.
- Authorization tokens used for Git operations are short-lived IPC payloads
  issued by the main process. They are sensitive capability grants and should
  remain time-limited and scoped.
- Potentially large payloads include generated media (`video:save-generated-file`
  allows a large base64 value), render/project data and task images. These are
  bounded by schemas but remain a performance and memory risk; measure before
  changing them.
- No handler without an input/output contract was found in the current static
  registration set. Direct `ipc.handle` use is confined to the Companion
  helper, where contracts are still applied.

## Follow-up matrix

| Finding | Confidence | Priority | Safe next action |
|---|---|---|---|
| No orphan invoke channel proven | High for declaration/handler/preload; medium for screen coverage | Observation | Add a generated consumer check before future channel additions |
| Renderer secret ingress exists for explicit configuration/import | High | P1 | Document threat boundary and consider main-owned dialogs/file pickers |
| `video` has 150 channels and large payloads | High | P1 | Extract handler groups and measure payload sizes |
| `main/index.ts` has composition and policy mixed | High | P0 | Extract one domain at a time with unchanged IPC contracts |
| `createExtensionUpdater` only wraps installer and has no production caller | Medium | P2 | Decide its future contract after registry design; do not remove now |
