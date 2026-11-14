import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, session } from 'electron';
import { ClaudeCliAdapter, CodexCliAdapter } from '@neuralbridge/agents';
import { BrainService, HybridSearch, importCodexConversations, loadProjectProfile, projectScope, projectTaskContext } from '@neuralbridge/brain';
import { autonomousMissions, autonomousMissionTasks, AzureDevOpsRepository, tasks } from '@neuralbridge/database';
import {
  AzureDevOpsClient,
  createAutonomousMissionMode,
  createDatabaseExtensionRegistry,
  createExtensionInstaller,
  skillUsageAnalytics,
  tokenReport,
  type MissionState,
} from '@neuralbridge/orchestrator';
import {
  azureDevOpsWriteRequestSchema,
  IpcChannel,
  IpcEvent,
  type AzureDevOpsWriteRequest,
  type ImportedConversationSummary,
  type TaskChanged,
} from '@neuralbridge/shared';
import {
  createSkillDiscoveryEngine,
  createSkillRecommendationEngine,
  createSkillStudioService,
  createTransactionalSkillInstaller,
  defaultGlobalSkillRoots,
  gitDiff,
  gitDiffRange,
  gitInfo,
  gitRun,
  installRemoteSkillRepository,
  runValidation,
  scanSkills,
  type SkillTransaction,
  validateRemoteSkillSource,
} from '@neuralbridge/workspace';
import { CORE_TIMING } from '@neuralbridge/core/protocol';
import { AzureDevOpsCredentialStore } from '../../../../packages/desktop-shared/src/main/azure-devops-credential-store.js';
import { createBrainAdmin } from '../../../../packages/desktop-shared/src/main/brain-admin.js';
import { createBrainService } from '../../../../packages/desktop-shared/src/main/brain.js';
import { createCoreSupervisor } from '../../../../packages/desktop-shared/src/main/core/index.js';
import { createHybridTaskService } from '../../../../packages/desktop-shared/src/main/core/hybrid-task-service.js';
import {
  currentUserId,
  DEFAULT_TASK_NAME,
  defaultSchtasks,
  launchStandaloneCore,
  LogonTask,
  readStandalone,
  STANDALONE_FLAG,
} from '../../../../packages/desktop-shared/src/main/core/standalone.js';
import { waitForCore } from '../../../../packages/desktop-shared/src/main/core/wait-for-core.js';
import { initDatabase } from '../../../../packages/desktop-shared/src/main/database.js';
import { createDatabaseRecovery } from '../../../../packages/desktop-shared/src/main/database-recovery.js';
import { createDiagnosticsExport } from '../../../../packages/desktop-shared/src/main/diagnostics-export.js';
import { createGitAutomationService } from '../../../../packages/desktop-shared/src/main/git-automation.js';
import { registerGitIpcHandlers } from '../../../../packages/desktop-shared/src/main/git-ipc-handlers.js';
import { registerCoreIpcHandlers } from '../../../../packages/desktop-shared/src/main/handlers/core.js';
import { registerDiagnosticsReleaseIpcHandlers } from '../../../../packages/desktop-shared/src/main/handlers/diagnostics-release.js';
import { registerExtensionIpcHandlers } from '../../../../packages/desktop-shared/src/main/handlers/extensions.js';
import { createMonitoring, registerMonitoringIpcHandlers } from '../../../../packages/desktop-shared/src/main/handlers/monitoring.js';
import { registerRecoveryIpcHandlers } from '../../../../packages/desktop-shared/src/main/handlers/recovery.js';
import { registerSkillsCatalogIpcHandlers } from '../../../../packages/desktop-shared/src/main/handlers/skills-catalog.js';
import { registerSkillsIntelligenceIpcHandlers } from '../../../../packages/desktop-shared/src/main/handlers/skills-intelligence.js';
import { registerTasksIpcHandlers } from '../../../../packages/desktop-shared/src/main/handlers/tasks.js';
import { registerThemeIpcHandlers } from '../../../../packages/desktop-shared/src/main/handlers/theme.js';
import { createHistorySyncRuntime } from '../../../../packages/desktop-shared/src/main/history-sync-runtime.js';
import { registerIpcHandler } from '../../../../packages/desktop-shared/src/main/ipc/handle.js';
import { createMcpService } from '../../../../packages/desktop-shared/src/main/mcp.js';
import { inspectPreferences, readPreferences, writePreferences } from '../../../../packages/desktop-shared/src/main/preferences.js';
import { createProjectService } from '../../../../packages/desktop-shared/src/main/projects.js';
import { isAppUrl, type AppLocation } from '../../../../packages/desktop-shared/src/main/security/navigation.js';
import { createSemanticService } from '../../../../packages/desktop-shared/src/main/semantic.js';
import { composeTaskEngine } from '../../../../packages/desktop-shared/src/main/task-composition.js';
import { createTaskService } from '../../../../packages/desktop-shared/src/main/tasks.js';
import { createWorkflowService } from '../../../../packages/desktop-shared/src/main/workflows.js';

export function registerOrchestratorDomainIpc(options: {
  location: AppLocation;
  migrationsFolder: string;
}): void {
  const { location, migrationsFolder } = options;
  const userDataDir = app.getPath('userData');
  const preferencesFile = join(userDataDir, 'preferences.json');
  const isTrustedSender = (url: string): boolean => isAppUrl(url, location);

  const database = initDatabase(userDataDir, migrationsFolder);
  const configurationStatus = inspectPreferences(preferencesFile);
  const extensionRegistry = database.handle ? createDatabaseExtensionRegistry(database.handle) : null;
  const extensionInstaller = extensionRegistry
    ? createExtensionInstaller({
        coreVersion: app.getVersion(),
        registry: extensionRegistry,
        installRoot: join(userDataDir, 'extensions'),
        verifySignature: (manifest) => manifest.signature.value === manifest.checksum.slice('sha256:'.length),
      })
    : null;

  app.on('will-quit', () => {
    database.handle?.close();
  });

  const claude = new ClaudeCliAdapter();
  const codex = new CodexCliAdapter();
  const agents = [claude, codex];

  registerDiagnosticsReleaseIpcHandlers(
    ipcMain,
    {
      getAppInfo: () => ({
        name: app.getName(),
        version: app.getVersion(),
        platform: process.platform,
        electron: process.versions.electron,
      }),
      getAppStatus: () => ({ database: database.status, configuration: configurationStatus }),
    },
    isTrustedSender,
  );

  const exportDiagnostics = createDiagnosticsExport({
    dataDir: userDataDir,
    migrationsFolder,
    app: { version: app.getVersion(), platform: process.platform, architecture: process.arch },
    database: () => database.status,
    appliedMigrations: () =>
      database.handle ? (database.handle.sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n : null,
    configuration: () => configurationStatus,
    get agents() {
      return agents;
    },
  });

  registerRecoveryIpcHandlers(
    ipcMain,
    {
      recovery: createDatabaseRecovery({
        file: database.status.file,
        backupsDir: join(userDataDir, 'backups', 'brain'),
        status: () => database.status,
      }),
      relaunch: () => {
        if (!app.isPackaged && process.env['NB_E2E_NO_RELAUNCH'] === '1') return;
        app.relaunch();
        app.exit(0);
      },
      exportDiagnostics: async () => {
        const file = await exportDiagnostics();
        return file;
      },
    },
    isTrustedSender,
  );

  registerExtensionIpcHandlers(ipcMain, { registry: extensionRegistry, installer: extensionInstaller }, isTrustedSender);

  // Core supervisor & MCP
  const coreScript = join(__dirname, 'core.js');
  const core = createCoreSupervisor({
    dataDir: userDataDir,
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    script: coreScript,
    execPath: process.execPath,
  });
  if (existsSync(coreScript)) core.start();

  app.on('will-quit', () => {
    const before = core.current();
    void core.stop();
    if (readStandalone(userDataDir).enabled && before.state === 'running' && before.pid) {
      launchStandaloneCore({
        execPath: process.execPath,
        script: coreScript,
        dataDir: userDataDir,
        version: app.getVersion(),
        waitPid: before.pid,
      });
    }
  });

  const taskName = !app.isPackaged && process.env['NB_CORE_TASK_NAME'] ? process.env['NB_CORE_TASK_NAME'] : DEFAULT_TASK_NAME;
  registerCoreIpcHandlers(ipcMain, core, isTrustedSender, {
    dataDir: userDataDir,
    task: new LogonTask(defaultSchtasks(), taskName, join(userDataDir, 'tmp')),
    command: process.execPath,
    args: app.isPackaged ? [STANDALONE_FLAG] : [app.getAppPath(), STANDALONE_FLAG],
    userId: currentUserId(),
    execPath: process.execPath,
    script: coreScript,
    version: app.getVersion(),
  });

  const mcp = createMcpService({
    appExecutable: process.execPath,
    serverScript: join(__dirname, 'mcp-server.js'),
    backupDir: join(userDataDir, 'backups', 'client-config'),
  });
  registerIpcHandler(ipcMain, IpcChannel.mcpStatus, () => mcp.status(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.mcpRegister, ({ client }) => mcp.register(client), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.mcpRegisterAlias, ({ client }) => mcp.registerAlias(client), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.mcpUnregister, ({ client }) => mcp.unregister(client), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.mcpServers, ({ refresh }) => mcp.servers(refresh), isTrustedSender);

  // Semantic, Brain, Brain3D, Galaxy, Learning & Backups
  const semantic = createSemanticService({
    handle: database.handle,
    modelsDir: join(userDataDir, 'models'),
    log: (message) => console.error(`[semantic] ${message}`),
  });
  app.on('will-quit', () => semantic.dispose());
  registerIpcHandler(ipcMain, IpcChannel.semanticStatus, () => semantic.status(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.semanticEnable, () => semantic.enable(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.semanticDisable, () => semantic.disable(), isTrustedSender);

  const brain = createBrainService({ handle: database.handle, provider: semantic.provider, onChange: () => semantic.schedule() });
  registerIpcHandler(ipcMain, IpcChannel.brainOverview, async () => brain.overview(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.brainSearch, (input) => brain.search(input), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.brainList, async (filter) => brain.list(filter), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.brainGet, async ({ id }) => brain.get(id), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.brainVersions, async ({ id }) => brain.versions(id), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.brainStore, async (input) => brain.store(input), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.brainDelete, async ({ id, hard }) => brain.remove(id, hard), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.brainConfidence, async ({ id, confidence }) => brain.setConfidence(id, confidence), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.brainRevalidate, async ({ id }) => brain.revalidate(id), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.brainProjects, async () => brain.projects(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.brainTags, async () => brain.tags(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.brainGraph, async () => brain.graph(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.brainGraph3d, async () => brain.graph3d(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.brainSimilarity, () => brain.similarity(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.brainGalaxy, async () => brain.galaxy(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.brainActivity, async ({ since }) => brain.activity(since), isTrustedSender);

  const brainAdmin = createBrainAdmin({
    handle: database.handle,
    backupsDir: join(userDataDir, 'backups', 'brain'),
    migrationsFolder,
    onMemoriesChanged: () => semantic.schedule(),
  });
  registerIpcHandler(ipcMain, IpcChannel.brainSettings, async () => brainAdmin.settings(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.brainSaveSettings, async (settings) => brainAdmin.saveSettings(settings), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.brainLearning, async ({ status }) => brainAdmin.learning(status), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.brainLearningApprove, async ({ id, edits }) => brainAdmin.approve(id, edits ?? {}), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.brainLearningReject, async ({ id }) => (brainAdmin.reject(id), { ok: true as const }), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.brainBackups, async () => brainAdmin.backups(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.brainBackupCreate, async () => brainAdmin.createBackup(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.brainBackupRestore, ({ name }) => brainAdmin.restore(name), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.brainRetention, async () => brainAdmin.applyRetention(), isTrustedSender);
  registerIpcHandler(
    ipcMain,
    IpcChannel.brainExport,
    async ({ format }) => {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      if (format === 'json') {
        const options = {
          title: 'Exportar memórias',
          defaultPath: `singularity-memorias-${new Date().toISOString().slice(0, 10)}.json`,
          filters: [{ name: 'JSON', extensions: ['json'] }],
        };
        const picked = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
        if (picked.canceled || !picked.filePath) return null;
        return { ...brainAdmin.exportJson(picked.filePath), path: picked.filePath };
      }
      const options = {
        title: 'Escolha onde criar a pasta com as memórias em Markdown',
        properties: ['openDirectory' as const, 'createDirectory' as const],
      };
      const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      const [parent] = picked.filePaths;
      if (picked.canceled || !parent) return null;
      const { count, folder } = brainAdmin.exportMarkdown(parent);
      return { count, path: folder };
    },
    isTrustedSender,
  );
  registerIpcHandler(
    ipcMain,
    IpcChannel.brainImport,
    async () => {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const options = {
        title: 'Importar memórias',
        properties: ['openFile' as const],
        filters: [{ name: 'Exportação do Singularity', extensions: ['json'] }],
      };
      const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      const [file] = picked.filePaths;
      if (picked.canceled || !file) return null;
      return brainAdmin.importJson(file);
    },
    isTrustedSender,
  );

  // Projects & Git Intelligence
  const projects = createProjectService({ handle: database.handle });
  registerIpcHandler(ipcMain, IpcChannel.projectsList, async () => projects.list(), isTrustedSender);
  registerIpcHandler(
    ipcMain,
    IpcChannel.projectsPick,
    async () => {
      const window = BrowserWindow.getFocusedWindow();
      const options = { title: 'Escolha a pasta do projeto', properties: ['openDirectory' as const] };
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    isTrustedSender,
  );
  registerIpcHandler(ipcMain, IpcChannel.projectsAdd, ({ path }) => projects.add(path), isTrustedSender);
  registerIpcHandler(
    ipcMain,
    IpcChannel.projectsDiscover,
    ({ path }) =>
      projects.discover(path, (scanned) => {
        for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IpcEvent.projectDiscoveryProgress, scanned);
      }),
    isTrustedSender,
  );
  registerIpcHandler(ipcMain, IpcChannel.projectsDiscoverCancel, async () => projects.cancelDiscovery(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsDiscoverConfirm, ({ root, choices }) => projects.confirmDiscovery(root, choices), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsMove, async ({ id, parentId }) => projects.move(id, parentId), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsSetKind, async ({ id, kind }) => projects.setKind(id, kind), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsGitState, () => projects.gitState(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsCreate, (input) => projects.create(input), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsClone, (input) => projects.clone(input), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsInitGit, ({ id, allowNested }) => projects.initGit(id, allowNested), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsGet, ({ id }) => projects.get(id), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsRefresh, ({ id }) => projects.refresh(id), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsUpdate, ({ id, changes }) => projects.update(id, changes), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsImpact, async ({ id }) => projects.impact(id), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsRemove, async ({ id }) => projects.remove(id), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsDiff, ({ id, path, commit }) => projects.diff(id, path, commit), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsLineStats, ({ id }) => projects.lineStats(id), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsProfile, async ({ id }) => projects.profile(id), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsProfileRefresh, ({ id }) => projects.refreshProfile(id), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsGitIndex, ({ id }) => projects.indexGit(id), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsGitSearch, async ({ id, query }) => projects.searchGit(id, query), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsGitRelations, async ({ id, hash }) => projects.commitRelations(id, hash), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsGitHistory, async ({ id, cursor }) => projects.history(id, cursor), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsGitCompare, async ({ id, left, right, mode }) => projects.compare(id, left, right, mode), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsGitSyncStatus, async ({ id }) => projects.syncStatus(id), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsGitWorkingTree, async ({ id }) => projects.workingTree(id), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsGitAuthorize, async ({ id, operation, parameters }) => projects.authorize(id, operation, parameters), isTrustedSender);
  registerGitIpcHandlers(ipcMain, projects, isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsGitBranches, async ({ id }) => projects.branches(id), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsGitStashes, async ({ id }) => projects.stashes(id), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsGitOperationState, async ({ id }) => projects.operationState(id), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.projectsFile, async ({ id, path }) => projects.readFile(id, path), isTrustedSender);

  // Azure DevOps / TFS
  const azureDevOpsRepository = database.handle ? new AzureDevOpsRepository(database.handle.db) : null;
  const azureDevOpsCredentials = new AzureDevOpsCredentialStore(join(userDataDir, 'azure-devops-credentials.bin'), safeStorage);
  const azureDevOpsAuthWindows = new Map<string, BrowserWindow>();
  const azureDevOpsRuntimeCredentials = new Map<string, { username: string; password: string }>();
  const pendingAzureWrites = new Map<string, { connectionId: string; request: AzureDevOpsWriteRequest; summary: string; target: string }>();
  const azureConnectionOf = (id: string) => {
    const connection = azureDevOpsRepository?.connection(id);
    if (!connection) throw new Error('not_found: conexão TFS não encontrada.');
    return connection;
  };
  const azureClientOf = (id: string) => {
    const connection = azureConnectionOf(id);
    const token = azureDevOpsCredentials.load(id);
    const basic = azureDevOpsRuntimeCredentials.get(id) ?? azureDevOpsCredentials.loadBasic(id);
    const authorization = token
      ? `Basic ${Buffer.from(`:${token}`, 'utf8').toString('base64')}`
      : basic
        ? `Basic ${Buffer.from(`${basic.username}:${basic.password}`, 'utf8').toString('base64')}`
        : null;
    const authSession = session.fromPartition(`persist:azure-devops-${id}`);
    return new AzureDevOpsClient(
      { baseUrl: connection.baseUrl, collection: connection.collection, project: connection.project, readOnly: connection.readOnly },
      { authorization, http: (url, init) => authSession.fetch(url, init), writeHttp: (url, init) => authSession.fetch(url, init) },
    );
  };
  registerIpcHandler(ipcMain, IpcChannel.azureDevOpsConnectionSave, async (input) => {
    if (!azureDevOpsRepository) throw new Error('unavailable: banco indisponível.');
    const id = azureDevOpsRepository.saveConnection(input);
    return { id, status: 'disconnected' as const };
  }, isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.azureDevOpsConnectionStatus, async ({ id }) => azureConnectionOf(id), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.azureDevOpsProbe, async ({ id }) => {
    try {
      const capabilities = await azureClientOf(id).capabilities();
      azureDevOpsRepository?.setStatus(id, 'connected', capabilities);
      return { status: 'connected' as const, capabilities };
    } catch (error) {
      const code = (error as { azureDevOps?: { code?: string } }).azureDevOps?.code;
      const status = code === 'login_required' ? ('login_required' as const) : code === 'forbidden' ? ('forbidden' as const) : ('unavailable' as const);
      azureDevOpsRepository?.setStatus(id, status);
      throw error;
    }
  }, isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.azureDevOpsProjects, async ({ id }) => azureClientOf(id).listProjects(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.azureDevOpsRepositories, async ({ id }) => azureClientOf(id).listRepositories(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.azureDevOpsBoards, async ({ id }) => azureClientOf(id).listBoards(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.azureDevOpsPullRequests, async ({ id, repositoryId, status }) => azureClientOf(id).listPullRequests(repositoryId, status), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.azureDevOpsWorkItems, async ({ id, ids }) => azureClientOf(id).getWorkItems(ids), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.azureDevOpsQueryWorkItems, async ({ id, type, iterationPath, parentId }) => azureClientOf(id).queryWorkItems(type, iterationPath, parentId), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.azureDevOpsWorkItemAttachment, async ({ id, workItemId, attachmentId }) => {
    const workItem = (await azureClientOf(id).getWorkItems([workItemId]))[0];
    if (!workItem?.attachments.some((attachment) => attachment.id === attachmentId)) throw new Error('forbidden: anexo não pertence ao work item.');
    return azureClientOf(id).getWorkItemAttachment(attachmentId);
  }, isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.azureDevOpsIterations, async ({ id }) => azureClientOf(id).listIterations(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.azureDevOpsPullRequestDetail, async ({ id, repositoryId, pullRequestId }) => azureClientOf(id).pullRequestDetail(repositoryId, pullRequestId), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.azureDevOpsPullRequestThreads, async ({ id, repositoryId, pullRequestId }) => azureClientOf(id).pullRequestThreads(repositoryId, pullRequestId), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.azureDevOpsPullRequestChanges, async ({ id, repositoryId, pullRequestId }) => azureClientOf(id).pullRequestChanges(repositoryId, pullRequestId), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.azureDevOpsOpenBrowser, async ({ id }) => {
    const connection = azureConnectionOf(id);
    const existing = azureDevOpsAuthWindows.get(id);
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return { opened: true as const };
    }
    const authWindow = new BrowserWindow({
      width: 560,
      height: 520,
      title: 'Login Azure DevOps / TFS',
      webPreferences: { partition: `persist:azure-devops-${id}`, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    azureDevOpsAuthWindows.set(id, authWindow);
    authWindow.on('closed', () => azureDevOpsAuthWindows.delete(id));
    await authWindow.loadURL(`${connection.baseUrl}/${encodeURIComponent(connection.collection)}/${encodeURIComponent(connection.project)}`);
    return { opened: true as const };
  }, isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.azureDevOpsCredentialSave, async ({ id, token }) => {
    azureConnectionOf(id);
    azureDevOpsCredentials.save(id, token);
    return { saved: true as const };
  }, isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.azureDevOpsCredentialClear, async ({ id }) => {
    azureConnectionOf(id);
    azureDevOpsCredentials.clear(id);
    return { cleared: true as const };
  }, isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.azureDevOpsCredentialStatus, async ({ id }) => {
    azureConnectionOf(id);
    return { configured: azureDevOpsCredentials.load(id) !== null };
  }, isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.azureDevOpsWritePrepare, async ({ id, request }) => {
    const connection = azureConnectionOf(id);
    if (connection.readOnly) throw new Error('read_only: habilite escrita para esta conexão antes de preparar uma operação.');
    const parsed = azureDevOpsWriteRequestSchema.parse(request);
    const operationId = randomUUID();
    const target =
      parsed.action === 'comment_pr' || parsed.action === 'set_pr_status'
        ? `PR #${parsed.pullRequestId}`
        : parsed.action === 'update_work_item'
          ? `Work item #${parsed.workItemId}`
          : `${parsed.type}: ${parsed.title}`;
    const summary = `Operação ${parsed.action} em ${target}`;
    pendingAzureWrites.set(operationId, { connectionId: id, request: parsed, summary, target });
    return { operationId, action: parsed.action, target, summary, requiresApproval: true as const };
  }, isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.azureDevOpsWriteExecute, async ({ id, operationId }) => {
    const pending = pendingAzureWrites.get(operationId);
    if (!pending || pending.connectionId !== id) throw new Error('forbidden: operação inexistente, expirada ou já executada.');
    const connection = azureConnectionOf(id);
    if (connection.readOnly) throw new Error('read_only: conexão TFS em modo somente leitura.');
    const window = BrowserWindow.getFocusedWindow();
    const options = {
      type: 'warning' as const,
      buttons: ['Cancelar', 'Subir/Publicar'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Confirmar alteração no Azure DevOps',
      message: pending.target,
      detail: pending.summary,
    };
    const result = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
    if (result.response !== 1) return { approved: false as const };
    pendingAzureWrites.delete(operationId);
    const client = azureClientOf(id);
    const request = pending.request;
    if (request.action === 'comment_pr') return { approved: true as const, result: await client.commentPullRequest(request.repositoryId, request.pullRequestId, request.content) };
    if (request.action === 'set_pr_status') return { approved: true as const, result: await client.setPullRequestStatus(request.repositoryId, request.pullRequestId, request.status) };
    if (request.action === 'create_work_item') return { approved: true as const, result: await client.createWorkItem(request.type, request.title, request.description, request.parentId) };
    if (request.action === 'update_work_item') {
      return {
        approved: true as const,
        result: await client.updateWorkItem(request.workItemId, {
          ...(request.title === undefined ? {} : { title: request.title }),
          ...(request.description === undefined ? {} : { description: request.description }),
          ...(request.state === undefined ? {} : { state: request.state }),
        }),
      };
    }
    const fallback = request as AzureDevOpsWriteRequest & { workItemId: number; state?: string };
    return { approved: true as const, result: await client.updateWorkItemState(fallback.workItemId, fallback.state ?? 'Active') };
  }, isTrustedSender);

  // Workflows & Tasks & Skills
  const workflows = createWorkflowService({ handle: database.handle });
  registerIpcHandler(ipcMain, IpcChannel.workflowsList, async ({ projectId }) => workflows.list(projectId), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.workflowsGet, async ({ id }) => workflows.get(id), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.workflowsSave, async ({ id, definition }) => workflows.save(id, definition), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.workflowsDelete, async ({ id }) => workflows.remove(id), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.workflowsRuns, async ({ workflowId }) => workflows.runs(workflowId), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.workflowsTimeline, async ({ runId }) => workflows.timeline(runId), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.workflowsSteps, async ({ runId }) => workflows.steps(runId), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.workflowsApproveStep, async ({ runId, stepId }) => workflows.approveStep(runId, stepId), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.workflowsRejectStep, async ({ runId, stepId }) => workflows.rejectStep(runId, stepId), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.workflowsDecideStep, async ({ runId, stepId, choice }) => workflows.decideStep(runId, stepId, choice), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.workflowsPause, async ({ runId }) => workflows.pause(runId), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.workflowsResume, async ({ runId }) => workflows.resume(runId), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.workflowsCancel, async ({ runId }) => workflows.cancel(runId), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.workflowsTemplates, async () => workflows.templates(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.workflowsInstantiateTemplate, async ({ templateId, projectId }) => workflows.instantiateTemplate(templateId, projectId), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.workflowsTemplateFavorite, async ({ templateId, favorite }) => workflows.favoriteTemplate(templateId, favorite), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.workflowsTemplateExport, async ({ templateId }) => workflows.exportTemplate(templateId), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.workflowsTemplateImport, async ({ payload }) => workflows.importTemplate(payload), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.workflowsLayoutSave, async ({ id, layout }) => workflows.saveLayout(id, layout), isTrustedSender);

  const managedSkillsRoot = join(userDataDir, 'managed-skills');
  const skillTransactionJournalRoot = join(userDataDir, 'skill-transactions');
  const skillTransactionStagingRoot = join(userDataDir, 'skill-staging');
  const skillStudioRoot = join(userDataDir, 'skill-studio');
  const skillRoots = [
    join(app.getPath('home'), '.claude', 'skills'),
    join(app.getPath('home'), '.claude', 'plugins'),
    join(app.getPath('home'), '.codex', 'skills'),
    join(app.getPath('home'), '.agents', 'skills'),
    managedSkillsRoot,
  ];

  const taskEngine = database.handle
    ? composeTaskEngine({
        handle: database.handle,
        adapters: { claude, codex },
        appExecutable: process.execPath,
        serverScript: join(__dirname, 'mcp-server.js'),
        dataDir: userDataDir,
        homeDir: app.getPath('home'),
        userDataDir,
        preferencesFile,
        semanticProvider: semantic.provider,
        propose: (proposals, context) => brainAdmin.propose(proposals, context),
        projectRoot: (projectId) => projects.root(projectId),
      })
    : null;
  app.on('before-quit', () => taskEngine?.cancelAll());

  const notifyWindows = (change: TaskChanged) => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IpcEvent.taskChanged, change);
  };
  taskEngine?.on('task', (update) => {
    if (update.kind === 'status') void workflows.taskEvent(update.taskId, update.status, update.error)?.catch(() => undefined);
    if (update.kind !== 'status' || update.status !== 'completed' || !database.handle) return;
    const projectId = database.handle.db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, update.taskId)).get()?.projectId;
    if (!projectId || !loadProjectProfile(database.handle, projectId)) return;
    projects.refreshProfile(projectId).catch(() => undefined);
  });

  const taskService =
    database.handle && taskEngine
      ? createTaskService({ handle: database.handle, engine: taskEngine, notify: notifyWindows, attachmentsDir: join(userDataDir, 'attachments') })
      : null;
  const hybridTasks =
    taskService && taskEngine && database.handle && process.env['NB_CORE_TASKS'] !== 'main'
      ? createHybridTaskService({
          local: taskService,
          engine: taskEngine,
          handle: database.handle,
          connection: () => core.connection(),
          log: (event, fields) => console.error(`[core] ${event}`, fields ?? {}),
        })
      : null;
  const coreForRecovery = hybridTasks
    ? waitForCore({
        state: () => core.current().state,
        connected: () => core.connection() !== null,
        onConnection: (listener) => core.onConnection(listener),
        timeoutMs: CORE_TIMING.readyTimeoutMs,
      })
    : Promise.resolve('desktop' as const);

  if (hybridTasks) {
    const detach = hybridTasks.attachEvents((listener) => core.onConnection(listener));
    app.on('will-quit', detach);
  }

  if (database.handle && taskService) {
    workflows.bind({
      startTask: (input) => {
        const taskInput = {
          prompt: input.prompt,
          projectId: input.projectId,
          mode: input.mode,
          access: input.access,
          ...(input.skillIds ? { skillIds: input.skillIds } : {}),
          ...(input.externalRef ? { externalRef: input.externalRef } : {}),
        };
        return hybridTasks ? hybridTasks.start(taskInput) : taskService.startWorkflowStep(input);
      },
      missingSkills: async (ids) => {
        const valid = new Set((await scanSkills(skillRoots)).filter((skill) => skill.valid).map((skill) => skill.id));
        return ids.filter((id) => !valid.has(id));
      },
      cancelTask: (id) => taskService.cancel(id),
      pauseTask: (id) => taskService.pause(id),
      resumeTask: (id) => taskService.resumePaused(id),
      executeNative: async (step, context) => {
        if (!context.projectId) throw new Error('invalid: Etapas nativas exigem projeto.');
        const root = projects.root(context.projectId);
        if (step.kind === 'rag') {
          return projects
            .searchWorkspace(context.projectId, step.query, step.topK)
            .map((hit) => `[${hit.projectName}] ${hit.reference}\n${hit.content}`)
            .join('\n\n');
        }
        if (step.kind === 'validation') {
          const result = await runValidation(root, step.command);
          if (!result.ok) throw new Error(`validation_failed: ${result.output}`);
          return result.output;
        }
        if (step.action === 'status') return JSON.stringify(await gitInfo(root));
        if (step.action === 'log') return (await gitRun(root, ['log', '-30', '--format=%h %an %s'])).stdout;
        if (step.action === 'diff-range') {
          const { base, head, hash } = context.trigger ?? {};
          if (base && head) return gitDiffRange(root, base, head);
          if (hash) return gitDiffRange(root, `${hash}~1`, hash);
          throw new Error('invalid: Esta etapa precisa de um commit ou de duas refs.');
        }
        return (await gitDiff(root, undefined, { includeUntracked: true })).text;
      },
    });
    void coreForRecovery.then(() => workflows.recover()).catch(() => undefined);
  }

  const missionHandle = database.handle;
  const missionMode =
    missionHandle && taskService && taskEngine
      ? createAutonomousMissionMode({
          load: async (id) => {
            const mission = missionHandle.db.select().from(autonomousMissions).where(eq(autonomousMissions.id, id)).get();
            if (!mission) return null;
            const rows = missionHandle.db.select().from(autonomousMissionTasks).where(eq(autonomousMissionTasks.missionId, id)).all();
            return {
              id: mission.id,
              status: mission.status as MissionState['status'],
              tasks: rows.map((row) => ({
                id: row.id,
                prompt: row.prompt,
                dependsOn: JSON.parse(row.dependsOn) as string[],
                status: row.status as MissionState['tasks'][number]['status'],
                attempts: row.attempts,
                ...(row.taskId ? { taskId: row.taskId } : {}),
                ...(row.error ? { error: row.error } : {}),
              })),
              maxAttempts: mission.maxAttempts,
              maxDurationMs: mission.maxDurationMs,
              maxCostUsd: mission.maxCostUsd,
              startedAt: Date.parse(mission.startedAt),
              costUsd: mission.costUsd,
            };
          },
          save: async (state) => {
            const handle = database.handle;
            if (!handle) return;
            handle.sqlite
              .transaction(() => {
                handle.db.update(autonomousMissions).set({ status: state.status, costUsd: state.costUsd, updatedAt: new Date().toISOString() }).where(eq(autonomousMissions.id, state.id)).run();
                for (const task of state.tasks) {
                  handle.db
                    .update(autonomousMissionTasks)
                    .set({ status: task.status, attempts: task.attempts, taskId: task.taskId ?? null, error: task.error ?? null, updatedAt: new Date().toISOString() })
                    .where(eq(autonomousMissionTasks.id, task.id))
                    .run();
                }
              })
              .immediate();
          },
          startTask: async (task) => {
            const started = await (hybridTasks
              ? hybridTasks.start({ prompt: task.prompt, projectId: null, mode: 'auto', access: 'read-only', externalRef: { system: 'mission', id: `mission/${task.id}`, revision: task.attempts } })
              : taskEngine.start({ prompt: task.prompt, projectId: null, mode: 'auto', access: 'read-only', externalRef: { system: 'mission', id: `mission/${task.id}`, revision: task.attempts } }));
            return typeof started === 'string' ? started : started.id;
          },
          validateAcceptance: async () => true,
        })
      : null;
  if (missionMode && database.handle) {
    const ids = database.handle.db.select({ id: autonomousMissions.id }).from(autonomousMissions).where(eq(autonomousMissions.status, 'running')).all().map((row) => row.id);
    void coreForRecovery.then(() => missionMode.recoverAll(ids));
  }
  taskEngine?.on('task', (update) => {
    if (update.kind === 'status' && missionMode) void missionMode.onTask({ taskId: update.taskId, status: update.status });
  });

  const gitAutomation =
    database.handle && taskService
      ? createGitAutomationService({
          handle: database.handle,
          root: (projectId) => projects.root(projectId),
          run: (workflowId, trigger) => workflows.run(workflowId, true, { trigger }),
        })
      : null;
  const needAutomation = () => {
    if (!gitAutomation) throw new Error('unavailable: O banco de dados está indisponível.');
    return gitAutomation;
  };
  registerIpcHandler(ipcMain, IpcChannel.workflowsAutomations, async ({ projectId }) => needAutomation().list(projectId), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.workflowsAutomationSave, async (input) => needAutomation().save(input), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.workflowsAutomationToggle, async ({ id, enabled }) => needAutomation().toggle(id, enabled), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.workflowsAutomationDelete, async ({ id }) => needAutomation().remove(id), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.workflowsAutomationEvents, async ({ id }) => needAutomation().events(id), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.workflowsRunFromGit, async (input) => needAutomation().runManually(input), isTrustedSender);
  const gitMonitorTimer = gitAutomation ? setInterval(() => void gitAutomation.poll().catch(() => undefined), 30_000) : undefined;
  app.on('will-quit', () => {
    if (gitMonitorTimer) clearInterval(gitMonitorTimer);
  });
  registerIpcHandler(ipcMain, IpcChannel.workflowsRun, async ({ id, approved, inputs }) => workflows.run(id, approved, inputs ? { inputs } : {}), isTrustedSender);

  const tasksForIpc = hybridTasks ?? taskService;
  registerTasksIpcHandlers(
    ipcMain,
    {
      tasks: tasksForIpc,
      projectRoot: (projectId) => projects.root(projectId),
      shell: { reveal: () => undefined, open: async () => null },
      agents,
      analytics: {
        tokens: (period) => {
          if (!database.handle) throw new Error('unavailable: O banco de dados está indisponível.');
          const now = new Date();
          const days = { '24h': 1, '7d': 7, '30d': 30, all: null }[period];
          return tokenReport(database.handle, {
            since: days === null ? '1970-01-01T00:00:00.000Z' : new Date(now.getTime() - days * 86_400_000).toISOString(),
            now,
          });
        },
        budget: () => readPreferences(preferencesFile).tokenBudget,
        saveBudget: (tokenBudget) => {
          writePreferences(preferencesFile, { ...readPreferences(preferencesFile), tokenBudget });
          taskEngine?.setTokenBudget(tokenBudget);
        },
      },
    },
    isTrustedSender,
  );

  registerSkillsIntelligenceIpcHandlers(
    ipcMain,
    {
      databaseHandle: database.handle,
      skillUsageAnalytics,
      recommendationEngine: createSkillRecommendationEngine(() => createSkillDiscoveryEngine(defaultGlobalSkillRoots(app.getPath('home'))).discover()),
      preferencesFile,
      readPreferences,
      readProjectIntelligence: async ({ databaseHandle, projectId, taskDescription, tokenBudget }) => {
        const contextProvider = async () => {
          const service = new BrainService(databaseHandle);
          const result = await new HybridSearch(service, semantic.provider).search(taskDescription, { limit: 20 }, projectScope(projectId, false), {
            kind: 'user',
            client: 'electron',
          });
          return projectTaskContext(loadProjectProfile(databaseHandle, projectId), result.hits, tokenBudget);
        };
        return Promise.all([gitInfo(projects.root(projectId)), contextProvider(), Promise.resolve(skillUsageAnalytics(databaseHandle))]).then(
          ([git, context, usage]) => ({ git, context, usage }),
        );
      },
    },
    isTrustedSender,
  );

  registerSkillsCatalogIpcHandlers(ipcMain, { preferencesFile, readPreferences, writePreferences, skillRoots, scanSkills }, isTrustedSender);

  const historySync = createHistorySyncRuntime({
    home: app.getPath('home'),
    stateFile: join(userDataDir, 'history-sync-state.json'),
    enabled: () => readPreferences(preferencesFile).historySync.enabled,
    paused: () => readPreferences(preferencesFile).historySync.paused,
    propose: (proposals, context) => Promise.resolve(brainAdmin.propose(proposals, context)),
  });
  registerIpcHandler(ipcMain, IpcChannel.historySyncSettings, async () => readPreferences(preferencesFile).historySync, isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.historySyncSettingsSave, async (settings) => {
    const current = readPreferences(preferencesFile);
    writePreferences(preferencesFile, { ...current, historySync: settings });
    if (settings.enabled && !settings.paused) {
      historySync.start(settings.pollIntervalMs);
      if (database.handle) void importCodexConversations(database.handle, app.getPath('home')).catch(() => undefined);
    } else {
      historySync.stop();
    }
    return { ok: true as const };
  }, isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.historySyncStatus, async () => historySync.status(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.historySyncRun, async () => {
    await historySync.run();
    if (database.handle && readPreferences(preferencesFile).historySync.enabled && !readPreferences(preferencesFile).historySync.paused) {
      await importCodexConversations(database.handle, app.getPath('home'));
    }
    return historySync.status();
  }, isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.importedConversationsList, async () => {
    if (!database.handle) return [];
    return database.handle.sqlite
      .prepare(
        'select id, agent, external_id as externalId, title, project_id as projectId, project_path as projectPath, association, updated_at as updatedAt, imported_at as importedAt from imported_conversations order by coalesce(updated_at, imported_at) desc limit 1000',
      )
      .all() as ImportedConversationSummary[];
  }, isTrustedSender);
  app.on('will-quit', () => historySync.stop());

  const transactionalSkills = createTransactionalSkillInstaller({ journalRoot: skillTransactionJournalRoot });
  const skillStudio = createSkillStudioService({
    root: skillStudioRoot,
    managedRoot: managedSkillsRoot,
    journalRoot: skillTransactionJournalRoot,
    stagingRoot: skillTransactionStagingRoot,
  });
  const resolveStudioSource = async (skillId: string) => {
    const skill = (await scanSkills(skillRoots)).find((item) => item.id === skillId || item.name === skillId);
    if (!skill) throw new Error('not_found: skill não encontrada para edição.');
    return { skillId: basename(resolve(skill.path, '..')), sourcePath: resolve(skill.path, '..') };
  };
  registerIpcHandler(ipcMain, IpcChannel.skillsStudioDrafts, () => skillStudio.listDrafts(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.skillsStudioCreate, (input) => {
    const { skillId, metadata, instructions, scope, files, projectId } = input;
    return skillStudio.createDraft({ skillId, metadata, instructions, scope, ...(files !== undefined ? { files } : {}), ...(projectId !== undefined ? { projectId } : {}) });
  }, isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.skillsStudioOpen, async (input) => skillStudio.openSkill({ ...(await resolveStudioSource(input.skillId)), scope: input.scope, projectId: input.projectId ?? null }), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.skillsStudioGet, ({ draftId }) => skillStudio.getDraft(draftId), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.skillsStudioSave, (input) => skillStudio.saveDraft(input), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.skillsStudioValidate, ({ draftId }) => skillStudio.validateDraft(draftId), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.skillsStudioPublish, (input) => skillStudio.publishDraft(input), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.skillsStudioVersions, ({ skillId }) => skillStudio.listVersions(skillId), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.skillsStudioCompare, (input) => skillStudio.compareVersions(input), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.skillsStudioRestore, (input) => skillStudio.restoreVersion(input.expectedFingerprint === undefined ? { skillId: input.skillId, versionId: input.versionId, confirmed: true } : { skillId: input.skillId, versionId: input.versionId, confirmed: true, expectedFingerprint: input.expectedFingerprint }), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.skillsStudioImportPreview, ({ sourcePath }) => skillStudio.previewImport(sourcePath), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.skillsStudioImport, (input) => skillStudio.importDraft(input), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.skillsStudioExport, (input) => skillStudio.exportVersion(input), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.skillsStudioSimulate, (input) => skillStudio.simulateRecommendation(input.draftId, { taskDescription: input.taskDescription, ...(input.projectId !== undefined ? { projectId: input.projectId } : {}), ...(input.stack !== undefined ? { stack: input.stack } : {}), ...(input.agent !== undefined ? { agent: input.agent } : {}), ...(input.taskType !== undefined ? { taskType: input.taskType } : {}), ...(input.workflowStep !== undefined ? { workflowStep: input.workflowStep } : {}), ...(input.limit !== undefined ? { limit: input.limit } : {}) }), isTrustedSender);

  const skillPreviews = new Map<string, Awaited<ReturnType<typeof transactionalSkills.prepare>>['preview']>();
  const skillTransactionSummary = (transaction: SkillTransaction) => ({
    id: transaction.id,
    skillId: transaction.skillId,
    destination: transaction.destination,
    operation: transaction.operation,
    state: transaction.state,
    fingerprint: transaction.fingerprint,
    backupAvailable: Boolean(transaction.backupPath),
    error: transaction.error,
    updatedAt: transaction.updatedAt,
  });
  registerIpcHandler(ipcMain, IpcChannel.skillsInstallPrepare, async ({ skillId, source, scope, agent }) => {
    if (scope !== 'global') throw new Error('unsupported_skill_scope: a integração IPC atual suporta apenas skills globais gerenciadas.');
    const settings = readPreferences(preferencesFile).skillSettings;
    validateRemoteSkillSource(source, settings.allowlistedHosts);
    const name = new URL(source).pathname.split('/').filter(Boolean).at(-1)?.replace(/\.git$/iu, '') ?? '';
    const prepared = await transactionalSkills.prepare({
      skillId,
      source,
      destination: join(managedSkillsRoot, name),
      allowedDestinationRoot: managedSkillsRoot,
      stagingRoot: skillTransactionStagingRoot,
      journalRoot: skillTransactionJournalRoot,
      scope,
      ...(agent ? { agent } : {}),
      sourceDescriptor: { kind: 'remote', value: source, scope, allowlistedHosts: settings.allowlistedHosts },
    });
    skillPreviews.set(prepared.transaction.id, prepared.preview);
    return { operationId: prepared.transaction.id, skillId: prepared.transaction.skillId, state: prepared.transaction.state, fingerprint: prepared.transaction.fingerprint, preview: prepared.preview };
  }, isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.skillsInstallPreview, async ({ operationId }) => {
    const preview = skillPreviews.get(operationId);
    if (!preview) throw new Error('not_found: prévia de instalação não está disponível nesta sessão.');
    return preview;
  }, isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.skillsInstallConfirm, async ({ operationId }) => {
    const transaction = await transactionalSkills.readJournal(operationId);
    if (!transaction.authorization) throw new Error('approval_required: autorização contextual não está disponível.');
    const completed = await transactionalSkills.commit(operationId, transaction.authorization);
    skillPreviews.delete(operationId);
    return skillTransactionSummary(completed);
  }, isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.skillsInstallStatus, async ({ operationId }) => skillTransactionSummary(await transactionalSkills.readJournal(operationId)), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.skillsInstallCancel, async ({ operationId }) => skillTransactionSummary(await transactionalSkills.cancel(operationId)), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.skillsInstallRollback, async ({ operationId }) => {
    const transaction = await transactionalSkills.readJournal(operationId);
    return skillTransactionSummary(
      await transactionalSkills.rollback(operationId, {
        operationId,
        origin: transaction.source,
        destination: transaction.destination,
        scope: transaction.scope,
        agent: transaction.agent,
        fingerprint: transaction.fingerprint,
        operation: 'rollback',
        summary: `rollback:${transaction.skillId}`,
        versionRef: null,
      }),
    );
  }, isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.skillsInstallHistory, async () => (await transactionalSkills.history()).map(skillTransactionSummary), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.skillsInstallRecovery, async () => (await transactionalSkills.recover()).map(skillTransactionSummary), isTrustedSender);
  const remoteSkillOperation = async (source: string, approved: true) => {
    if (!approved) throw new Error('approval_required: aprovação explícita obrigatória');
    const settings = readPreferences(preferencesFile).skillSettings;
    validateRemoteSkillSource(source, settings.allowlistedHosts);
    return { path: await installRemoteSkillRepository(source, managedSkillsRoot, settings.allowlistedHosts, true) };
  };
  registerIpcHandler(ipcMain, IpcChannel.skillsInstall, ({ source, approved }) => remoteSkillOperation(source, approved), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.skillsUpdate, ({ source, approved }) => remoteSkillOperation(source, approved), isTrustedSender);

  registerThemeIpcHandlers(ipcMain, { preferencesFile, setNativeTheme: (source) => { nativeTheme.themeSource = source; } }, isTrustedSender);

  const monitoring = createMonitoring({
    preferencesFile,
    dataDir: userDataDir,
    appMetrics: () =>
      app.getAppMetrics().map((metric) => ({
        pid: metric.pid,
        cpuPercent: metric.cpu.percentCPUUsage,
        workingSetBytes: metric.memory.workingSetSize * 1024,
      })),
    log: (message) => console.warn(`[monitoring] ${message}`),
  });
  registerMonitoringIpcHandlers(ipcMain, monitoring, preferencesFile, isTrustedSender);
  app.on('will-quit', () => monitoring.dispose());
}
