import { eq } from 'drizzle-orm';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, net, safeStorage, shell } from 'electron';
import { ClaudeCliAdapter, CodexCliAdapter } from '@neuralbridge/agents';
import { CORE_TIMING } from '@neuralbridge/core/protocol';
import { createBrainService } from '../../../../packages/desktop-shared/src/main/brain.js';
import {
  personalAccounts as personalAccountsTable,
  PersonalAutomationRepository,
  PersonalNotificationRepository,
  PersonalSyncRepository,
  tasks,
} from '@neuralbridge/database';
import {
  CompanionSessionRegistry,
  ComputerActionBroker,
  connectTaskEngineToCompanion,
  createDatabaseExtensionRegistry,
  createExtensionInstaller,
  OpenMeteoWeatherService,
  PersonalActionService,
  PersonalAutomationLoop,
  PersonalAutomationRuntime,
  SpotifyAdapter,
  tokenReport,
} from '@neuralbridge/orchestrator';
import {
  BUILTIN_EXTENSION_MANIFESTS,
  IpcChannel,
  IpcEvent,
  neuraSettingsSchema,
  type TaskChanged,
} from '@neuralbridge/shared';
import { createVoiceStudioClient } from '@neuralbridge/workspace';
import { CompanionHudController, isCompanionHudUrl } from '../../../../packages/desktop-shared/src/main/companion-hud-window.js';
import { registerCompanionIpcHandlers } from '../../../../packages/desktop-shared/src/main/companion-ipc.js';
import { sendCtrlV } from '../../../../packages/desktop-shared/src/main/computer-launcher.js';
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
import { registerCoreIpcHandlers } from '../../../../packages/desktop-shared/src/main/handlers/core.js';
import { registerDiagnosticsReleaseIpcHandlers } from '../../../../packages/desktop-shared/src/main/handlers/diagnostics-release.js';
import { registerExtensionIpcHandlers } from '../../../../packages/desktop-shared/src/main/handlers/extensions.js';
import { registerPersonalIpcHandlers } from '../../../../packages/desktop-shared/src/main/handlers/personal.js';
import { registerRecoveryIpcHandlers } from '../../../../packages/desktop-shared/src/main/handlers/recovery.js';
import { registerTasksIpcHandlers } from '../../../../packages/desktop-shared/src/main/handlers/tasks.js';
import { registerThemeIpcHandlers } from '../../../../packages/desktop-shared/src/main/handlers/theme.js';
import { registerIpcHandler } from '../../../../packages/desktop-shared/src/main/ipc/handle.js';
import { resolveDesktopLocalWorker } from '../../../../packages/desktop-shared/src/main/local-worker.js';
import { createDesktopLocationProvider } from '../../../../packages/desktop-shared/src/main/location-service.js';
import { registerNeuraIpc, type NeuraSettingsStore } from '../../../../packages/desktop-shared/src/main/neura-ipc.js';
import { createNeuraRuntime } from '../../../../packages/desktop-shared/src/main/neura-runtime.js';
import { VoiceStudioNeuraSpeech } from '../../../../packages/desktop-shared/src/main/neura-speech.js';
import { buildPkceAuthorizeUrl, createPkceSession, exchangePkceCode, parseDesktopOAuthClient, waitForLoopbackCallback } from '../../../../packages/desktop-shared/src/main/oauth/loopback.js';
import { OAuthSecretStore } from '../../../../packages/desktop-shared/src/main/oauth/secret-store.js';
import { PersonalActionExecutor } from '../../../../packages/desktop-shared/src/main/personal/action-executor.js';
import { PersonalAccountManager } from '../../../../packages/desktop-shared/src/main/personal/account-manager.js';
import { GoogleCalendarClient } from '../../../../packages/desktop-shared/src/main/personal/calendar-client.js';
import { GmailClient } from '../../../../packages/desktop-shared/src/main/personal/gmail-client.js';
import { GooglePersonalOAuth } from '../../../../packages/desktop-shared/src/main/personal/google-oauth.js';
import { PersonalSyncService } from '../../../../packages/desktop-shared/src/main/personal/sync-service.js';
import { inspectPreferences, readPreferences, writePreferences } from '../../../../packages/desktop-shared/src/main/preferences.js';
import { createProjectService } from '../../../../packages/desktop-shared/src/main/projects.js';
import { createDesktopScreenObserver } from '../../../../packages/desktop-shared/src/main/screen-observer.js';
import { armSystemAudio } from '../../../../packages/desktop-shared/src/main/security/harden.js';
import { IntegrationTokenStore } from '../../../../packages/desktop-shared/src/main/security/integration-token-store.js';
import { isAppUrl, type AppLocation } from '../../../../packages/desktop-shared/src/main/security/navigation.js';
import { createSemanticService } from '../../../../packages/desktop-shared/src/main/semantic.js';
import { SPOTIFY_ENDPOINTS, SpotifyService, type SpotifyEndpoints } from '../../../../packages/desktop-shared/src/main/spotify/service.js';
import { SpotifyTokenStore } from '../../../../packages/desktop-shared/src/main/spotify/token-store.js';
import { SystemAudioSource } from '../../../../packages/desktop-shared/src/main/system-audio-source.js';
import { composeTaskEngine } from '../../../../packages/desktop-shared/src/main/task-composition.js';
import { createTaskService } from '../../../../packages/desktop-shared/src/main/tasks.js';
import { ensureVoiceStudioRunning } from '../../../../packages/desktop-shared/src/main/voice-studio-launch.js';
import { VoiceStudioStreamingProvider } from '../../../../packages/desktop-shared/src/main/voicestudio-streaming-provider.js';
import { FirstAvailableVoiceProvider, VoiceStudioWhisperProvider } from '../../../../packages/desktop-shared/src/main/voicestudio-whisper-provider.js';
import { WindowsSpeechProvider, type SpeechCommand } from '../../../../packages/desktop-shared/src/main/windows-speech-provider.js';

export function registerVoidDomainIpc(options: {
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
  if (extensionRegistry) {
    extensionRegistry.registerBuiltIn(BUILTIN_EXTENSION_MANIFESTS.companion, 'enabled');
    extensionRegistry.registerBuiltIn(BUILTIN_EXTENSION_MANIFESTS.spotify, 'enabled');
    extensionRegistry.registerBuiltIn(BUILTIN_EXTENSION_MANIFESTS['personal-agent'], 'enabled');
  }
  const isExtensionEnabled = (id: 'companion' | 'spotify'): boolean => !extensionRegistry || extensionRegistry.get(id)?.state !== 'disabled';
  let applyCompanionExtensionState: (enabled: boolean) => void = () => undefined;
  let applySpotifyExtensionState: (enabled: boolean) => void = () => undefined;

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
        backupsDir: join(userDataDir, 'backups', 'void'),
        status: () => database.status,
      }),
      relaunch: () => {
        if (!app.isPackaged && process.env['NB_E2E_NO_RELAUNCH'] === '1') return;
        app.relaunch();
        app.exit(0);
      },
      exportDiagnostics: async () => exportDiagnostics(),
    },
    isTrustedSender,
  );

  registerExtensionIpcHandlers(
    ipcMain,
    {
      registry: extensionRegistry,
      installer: extensionInstaller,
      onStateChanged: (id, item) => {
        if (id === 'companion') applyCompanionExtensionState(item?.state === 'enabled');
        if (id === 'spotify') applySpotifyExtensionState(item?.state === 'enabled');
      },
    },
    isTrustedSender,
  );
  registerThemeIpcHandlers(ipcMain, { preferencesFile, setNativeTheme: (source) => { nativeTheme.themeSource = source; } }, isTrustedSender);

  // Personal Google OAuth, Gmail, Calendar, Sync & Automations (isolated in Void userData)
  const personalTokenStore = new IntegrationTokenStore(join(userDataDir, 'personal-integration-tokens.bin'), safeStorage);
  const personalGoogleOAuthStore = new OAuthSecretStore(join(userDataDir, 'personal-google-oauth.bin'), safeStorage);
  const personalGoogleOAuth = new GooglePersonalOAuth();
  const personalAccounts = new PersonalAccountManager(
    {
      saveToken: (accountId, token) => personalTokenStore.save(accountId, token),
      clearToken: (accountId) => personalTokenStore.clear(accountId),
    },
    database.handle
      ? {
          load: () =>
            database.handle?.db
              .select()
              .from(personalAccountsTable)
              .all()
              .map((row) => ({
                accountId: row.id,
                provider: row.provider as 'gmail' | 'calendar' | 'whatsapp',
                identifier: row.identifier,
                scopes: JSON.parse(row.scopesJson) as string[],
                state: row.state as 'disconnected' | 'connecting' | 'connected' | 'error' | 'revoked',
              })) ?? [],
          save: (account) => {
            const now = new Date().toISOString();
            database.handle?.db
              .insert(personalAccountsTable)
              .values({
                id: account.accountId,
                provider: account.provider,
                identifier: account.identifier,
                scopesJson: JSON.stringify(account.scopes),
                state: account.state,
                tokenFile: 'personal-integration-tokens.bin',
                createdAt: now,
                updatedAt: now,
              })
              .onConflictDoUpdate({
                target: personalAccountsTable.id,
                set: { provider: account.provider, identifier: account.identifier, scopesJson: JSON.stringify(account.scopes), state: account.state, updatedAt: now },
              })
              .run();
          },
          delete: (accountId) => {
            database.handle?.db.delete(personalAccountsTable).where(eq(personalAccountsTable.id, accountId)).run();
          },
        }
      : undefined,
  );
  const personalActionExecutor = new PersonalActionExecutor({
    token: (accountId) => personalTokenStore.load(accountId),
    gmail: (accessToken) => new GmailClient(accessToken),
    calendar: (accessToken) => new GoogleCalendarClient(accessToken),
  });
  const personalAutomationRepository = database.handle ? new PersonalAutomationRepository(database.handle.db) : null;
  const personalActions = database.handle
    ? new PersonalActionService(new ComputerActionBroker(database.handle, { executor: personalActionExecutor }), (result) => {
        if (result.status === 'completed') personalAutomationRepository?.resolveAction(result.actionId, 'completed');
        else if (result.status === 'failed' || result.status === 'denied' || result.status === 'cancelled' || result.status === 'expired') {
          personalAutomationRepository?.resolveAction(result.actionId, 'failed', result.message);
        }
      })
    : undefined;
  const personalNotificationRepository = database.handle ? new PersonalNotificationRepository(database.handle.db) : undefined;
  const personalSyncRepository = database.handle ? new PersonalSyncRepository(database.handle.db) : undefined;
  const personalSyncService =
    personalSyncRepository && personalNotificationRepository
      ? new PersonalSyncService({
          accounts: () => personalAccounts.list(),
          token: (accountId) => personalTokenStore.load(accountId),
          gmail: (token) => new GmailClient(token),
          calendar: (token) => new GoogleCalendarClient(token),
          sync: personalSyncRepository,
          notifications: personalNotificationRepository,
          onError: (accountId, error) => {
            personalAccounts.markError(accountId);
            console.error(`[personal-sync] ${accountId}: ${error instanceof Error ? error.message : String(error)}`);
          },
        })
      : null;
  const personalSyncTimer = personalSyncService ? setInterval(() => { void personalSyncService.run(); }, 60_000) : undefined;
  if (personalSyncService) void personalSyncService.run();
  const personalAutomationRuntime = personalAutomationRepository
    ? new PersonalAutomationRuntime({
        list: () => personalAutomationRepository.listRules(),
        saveNextRun: (id, nextRunAt) => personalAutomationRepository.saveNextRun(id, nextRunAt),
        hasRun: (idempotencyKey) => personalAutomationRepository.hasRun(idempotencyKey),
        saveRun: (idempotencyKey, state, error) => personalAutomationRepository.saveRun(idempotencyKey, state, error),
        execute: async (_id, action) => {
          if (!action || action.kind === 'notify') return undefined;
          if (!personalActions) throw new Error('unavailable: ações pessoais indisponíveis.');
          if (action.kind === 'mail.send') return personalActions.sendMail(action);
          return personalActions.createEvent(action);
        },
      })
    : null;
  const personalAutomationLoop = personalAutomationRuntime ? new PersonalAutomationLoop(personalAutomationRuntime) : null;
  personalAutomationLoop?.start();

  app.on('will-quit', () => {
    personalAutomationLoop?.stop();
    if (personalSyncTimer) clearInterval(personalSyncTimer);
    database.handle?.close();
  });

  registerPersonalIpcHandlers(
    ipcMain,
    personalAccounts,
    isTrustedSender,
    {
      importClient: async () => {
        const result = await dialog.showOpenDialog({ title: 'Importar client_secret.json do Google', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
        if (result.canceled || !result.filePaths[0]) throw new Error('cancelled: importação do cliente OAuth cancelada.');
        const client = parseDesktopOAuthClient(JSON.parse(readFileSync(result.filePaths[0], 'utf8')) as unknown);
        personalGoogleOAuthStore.save({ client, tokens: null });
        return { configured: true as const, clientId: client.client_id };
      },
      connect: async (opts) => {
        const stored = personalGoogleOAuthStore.load();
        if (!stored) throw new Error('auth_required: importe primeiro o client_secret.json.');
        const client = parseDesktopOAuthClient(stored.client);
        const redirect = client.redirect_uris.find((uri) => { const url = new URL(uri); return url.hostname === '127.0.0.1' || url.hostname === 'localhost'; });
        if (!redirect) throw new Error('invalid: nenhum redirect loopback permitido no cliente OAuth.');
        const redirectUrl = new URL(redirect);
        const session = createPkceSession();
        const scopes = personalGoogleOAuth.scopes({ gmailSend: opts.gmailSend === true, calendarWrite: opts.calendarWrite === true });
        const callback = await waitForLoopbackCallback(session.state, { port: Number(redirectUrl.port || 80), timeoutMs: 5 * 60_000, path: redirectUrl.pathname });
        await shell.openExternal(buildPkceAuthorizeUrl(client, session, scopes, redirect));
        const tokens = await exchangePkceCode(client, await callback.code, session.verifier, redirect);
        const normalized = personalGoogleOAuth.normalizeTokens(tokens);
        if (!normalized.refreshToken) throw new Error('invalid: Google não retornou refresh token.');
        personalTokenStore.save('google-primary', normalized);
        const profile = await new GmailClient(normalized.accessToken).profile();
        personalAccounts.connect({ accountId: 'google-primary', provider: 'gmail', identifier: profile.emailAddress, scopes: normalized.scopes }, normalized);
        personalGoogleOAuthStore.save({ client, tokens: { access_token: tokens.access_token, refresh_token: tokens.refresh_token ?? normalized.refreshToken, expires_in: tokens.expires_in, scope: tokens.scope } });
        return { connected: true as const, scopes: normalized.scopes };
      },
    },
    personalActions,
    personalNotificationRepository,
  );

  // Core, TaskEngine & Companion
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
      launchStandaloneCore({ execPath: process.execPath, script: coreScript, dataDir: userDataDir, version: app.getVersion(), waitPid: before.pid });
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

  const semantic = createSemanticService({
    handle: database.handle,
    modelsDir: join(userDataDir, 'models'),
    log: (message) => console.error(`[semantic] ${message}`),
  });
  app.on('will-quit', () => semantic.dispose());
  const projects = createProjectService({ handle: database.handle });
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
        propose: () => [],
        projectRoot: (projectId) => projects.root(projectId),
      })
    : null;
  app.on('before-quit', () => taskEngine?.cancelAll());

  const notifyWindows = (change: TaskChanged) => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IpcEvent.taskChanged, change);
  };
  const taskService =
    database.handle && taskEngine
      ? createTaskService({ handle: database.handle, engine: taskEngine, notify: notifyWindows, attachmentsDir: join(userDataDir, 'attachments') })
      : null;
  const hybridTasks =
    taskService && taskEngine && database.handle && process.env['NB_CORE_TASKS'] !== 'main'
      ? createHybridTaskService({ local: taskService, engine: taskEngine, handle: database.handle, connection: () => core.connection(), log: () => undefined })
      : null;
  if (hybridTasks) {
    const detach = hybridTasks.attachEvents((listener) => core.onConnection(listener));
    app.on('will-quit', detach);
  }
  void (hybridTasks
    ? waitForCore({ state: () => core.current().state, connected: () => core.connection() !== null, onConnection: (listener) => core.onConnection(listener), timeoutMs: CORE_TIMING.readyTimeoutMs })
    : Promise.resolve('desktop' as const));

  registerTasksIpcHandlers(
    ipcMain,
    {
      tasks: hybridTasks ?? taskService,
      projectRoot: (projectId) => projects.root(projectId),
      shell: { reveal: (path) => shell.showItemInFolder(path), open: async (path) => (await shell.openPath(path)) || null },
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

  const companionRegistry = database.handle && taskEngine ? new CompanionSessionRegistry({ handle: database.handle }) : null;
  const disconnectCompanion =
    companionRegistry && taskEngine
      ? connectTaskEngineToCompanion(taskEngine, companionRegistry, {
          projectIdForTask: (taskId) => database.handle?.db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, taskId)).get()?.projectId ?? null,
        })
      : null;
  const disposeCompanionIpc = registerCompanionIpcHandlers(ipcMain, companionRegistry, isTrustedSender, () => isExtensionEnabled('companion'));
  app.on('before-quit', () => {
    disconnectCompanion?.();
    disposeCompanionIpc();
  });

  // Spotify OAuth & Playback
  const spotifyEndpoints: SpotifyEndpoints = app.isPackaged
    ? SPOTIFY_ENDPOINTS
    : {
        accounts: process.env['NB_SPOTIFY_ACCOUNTS_URL'] ?? SPOTIFY_ENDPOINTS.accounts,
        api: process.env['NB_SPOTIFY_API_URL'] ?? SPOTIFY_ENDPOINTS.api,
        imageHosts: process.env['NB_SPOTIFY_IMAGE_HOST'] ? [process.env['NB_SPOTIFY_IMAGE_HOST']] : SPOTIFY_ENDPOINTS.imageHosts,
      };
  const spotify = new SpotifyService({
    store: new SpotifyTokenStore(join(userDataDir, 'spotify-tokens.bin'), safeStorage),
    readConfig: () => readPreferences(preferencesFile).spotify,
    writeConfig: (config) => writePreferences(preferencesFile, { ...readPreferences(preferencesFile), spotify: { ...config, last: config.last ?? null } }),
    openExternal: (url) => shell.openExternal(url),
    fetch: (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
    endpoints: spotifyEndpoints,
  });
  applySpotifyExtensionState = (enabled) => spotify.setExtensionEnabled(enabled);
  spotify.setExtensionEnabled(isExtensionEnabled('spotify'));
  const neuraSpotify = new SpotifyAdapter(spotify);
  spotify.on('changed', (status) => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IpcEvent.spotifyChanged, status);
  });
  app.on('before-quit', () => spotify.dispose());
  registerIpcHandler(ipcMain, IpcChannel.spotifyStatus, async () => spotify.status(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.spotifyConfigure, (changes) => spotify.configure(changes), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.spotifyConnect, () => spotify.connect(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.spotifyCancelConnect, async () => { spotify.cancelConnect(); return { ok: true as const }; }, isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.spotifyDisconnect, async () => spotify.disconnect(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.spotifyControl, (control) => spotify.control(control), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.spotifyDevices, () => spotify.devices(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.spotifyOpenTrack, async () => { await spotify.openTrack(); return { ok: true as const }; }, isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.neuraSpotifyCommand, (input) => neuraSpotify.execute(input), isTrustedSender);

  // Neura (Voice, Meetings, Screen, Weather, Memory, Companion HUD)
  void ensureVoiceStudioRunning().catch(() => undefined);
  spotify.init();
  const localWorkerCommand = resolveDesktopLocalWorker({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    userDataPath: userDataDir,
    platform: process.platform,
    exists: existsSync,
    baseEnv: process.env,
  });
  const localWorker = new LocalWorkerClientShim(localWorkerCommand);
  const neuraSettings: NeuraSettingsStore = {
    read: () => readPreferences(preferencesFile).neura,
    write: (neura) => writePreferences(preferencesFile, { ...readPreferences(preferencesFile), neura }),
  };
  const fakeVoice = !app.isPackaged && process.env['NB_NEURA_VOICE_CMD'] ? (JSON.parse(process.env['NB_NEURA_VOICE_CMD']) as string[]) : null;
  const listenCommand: SpeechCommand | null = fakeVoice?.[0] ? { executable: fakeVoice[0], args: fakeVoice.slice(1) } : null;
  const whisper = new VoiceStudioWhisperProvider({ baseUrl: createVoiceStudioClient().baseUrl });
  const streamingVoice = new VoiceStudioStreamingProvider({ baseUrl: createVoiceStudioClient().baseUrl });
  const meetingAudio = new SystemAudioSource({ baseUrl: createVoiceStudioClient().baseUrl, onArmed: armSystemAudio });
  const screen = createDesktopScreenObserver({ outputDir: join(userDataDir, 'screen-captures'), consent: () => neuraSettings.read().screenConsent });
  const weatherLocation = createDesktopLocationProvider({
    consent: () => neuraSettings.read().locationConsent,
    fallbackPlace: () => neuraSettings.read().weatherLocation,
    window: () => BrowserWindow.getAllWindows().find((window) => !window.isDestroyed() && !isCompanionHudUrl(window.webContents.getURL())),
  });
  const weather = new OpenMeteoWeatherService({ location: weatherLocation });
  const desktopShell = {
    openExternal: (url: string) => shell.openExternal(url),
    typeText: async (text: string, opts?: { targetWindow?: string; targetElement?: { automationId?: string | undefined; name?: string | undefined; controlType?: string | undefined } }) => {
      clipboard.writeText(text);
      await sendCtrlV(opts?.targetWindow || opts?.targetElement ? { ...(opts.targetWindow ? { targetWindow: opts.targetWindow } : {}), ...(opts.targetElement ? { targetElement: opts.targetElement } : {}) } : { restorePreviousWindow: true });
    },
  };
  const brain = database.handle ? createBrainService({ handle: database.handle, provider: semantic.provider, onChange: () => semantic.schedule() }) : null;
  const globalMemory = brain
    ? {
        search: async (query: string, limit: number) =>
          (await brain.search({ query, projectId: null, limit })).hits
            .slice(0, limit)
            .map((hit) => ({ title: hit.title, snippet: hit.snippet, confidence: hit.confidence })),
      }
    : undefined;

  const hud = new CompanionHudController(
    location,
    preferencesFile,
    (shown) => {
      spotify.setActive(shown);
      if (!shown) void neura.stopHearing('o Companion foi ocultado ou fechado.').catch(() => undefined);
    },
    () => isExtensionEnabled('companion'),
  );
  applyCompanionExtensionState = (enabled) => hud.setExtensionEnabled(enabled);
  applyCompanionExtensionState(isExtensionEnabled('companion'));

  const neuraApp = {
    update: async (changes: { silentReplies?: boolean; agent?: 'claude' | 'codex' }) => {
      neuraSettings.write(neuraSettingsSchema.parse({ ...neuraSettings.read(), ...changes }));
      await neura.applySettings();
    },
    setPanelOpen: (open: boolean) => {
      if (open) hud.openPanel();
      else hud.setMode('mascot');
    },
  };
  const { neura, meeting } = createNeuraRuntime({
    app: neuraApp,
    meetingAudio,
    screen,
    weather,
    ...(globalMemory ? { memory: globalMemory } : {}),
    historyFile: join(userDataDir, 'neura-conversation.json'),
    settings: neuraSettings.read,
    startTask: ({ prompt, projectId, agent, externalRef }) => {
      const taskInput = { prompt, projectId, mode: agent, access: 'edit' as const, ...(externalRef ? { externalRef } : {}) };
      return hybridTasks ? hybridTasks.start(taskInput) : (taskEngine?.start(taskInput) ?? Promise.reject(new Error('unavailable: TaskEngine')));
    },
    engine: taskEngine,
    handle: database.handle ?? null,
    worker: localWorker.client,
    spotify: neuraSpotify,
    shell: desktopShell,
    voiceProvider: listenCommand
      ? new WindowsSpeechProvider({ listenCommand })
      : new FirstAvailableVoiceProvider([streamingVoice, whisper, new WindowsSpeechProvider()]),
  });
  const neuraSpeech = new VoiceStudioNeuraSpeech(createVoiceStudioClient());
  registerNeuraIpc(
    ipcMain,
    neura,
    neuraSettings,
    isTrustedSender,
    neuraSpeech,
    {
      accept: (wav) => whisper.accept(wav),
      acceptPcm: (pcm) => streamingVoice.acceptPcm(pcm),
      captureFailed: (detail) => { streamingVoice.captureFailed(detail); whisper.captureFailed(detail); },
    },
    (text) => clipboard.writeText(text),
    meetingAudio,
  );
  meetingAudio.onLost = (sessionId, detail) => { void neura.reportMeetingLost(sessionId, detail).catch(() => undefined); };
  neura.onState((state) => {
    hud.setPrivate(state.meeting !== null);
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IpcEvent.neuraChanged, state);
  });
  neura.onWake(() => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IpcEvent.neuraWake);
  });
  void neura.applySettings().catch(() => undefined);
  app.on('before-quit', () => {
    meeting.dispose();
    neura.dispose();
    void localWorker.dispose();
  });

  const isHudSender = (url: string): boolean => isTrustedSender(url) && isCompanionHudUrl(url);
  registerIpcHandler(ipcMain, IpcChannel.companionHudMode, async ({ mode }) => { hud.setMode(mode); return { ok: true as const }; }, isHudSender);
  registerIpcHandler(ipcMain, IpcChannel.companionHudDrag, async ({ phase }) => { hud.handleDrag(phase); return { ok: true as const }; }, isHudSender);
  registerIpcHandler(ipcMain, IpcChannel.companionHudInteractive, async ({ interactive }) => { hud.setInteractive(interactive); return { ok: true as const }; }, isHudSender);
  registerIpcHandler(ipcMain, IpcChannel.companionHudOpenSettings, async () => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !isCompanionHudUrl(w.webContents.getURL()));
    if (win) {
      void win.webContents.executeJavaScript("window.location.hash = '#/settings'");
      win.show();
      win.focus();
    }
    return { ok: true as const };
  }, isHudSender);
  registerIpcHandler(ipcMain, IpcChannel.companionHudState, async () => hud.state(), isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.companionHudVisibility, async ({ visible }) => { hud.setVisible(visible); return { ok: true as const }; }, isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.companionHudPin, async ({ alwaysOnTop }) => { hud.setPinned(alwaysOnTop); return { ok: true as const }; }, isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.companionHudResetPosition, async () => { hud.resetPosition(); return { ok: true as const }; }, isTrustedSender);
  registerIpcHandler(ipcMain, IpcChannel.companionHudOpenPanel, async () => { hud.openPanel(); return { ok: true as const }; }, isTrustedSender);
}

import { LocalWorkerClient } from '@neuralbridge/orchestrator';

class LocalWorkerClientShim {
  readonly client: LocalWorkerClient;
  constructor(command: ReturnType<typeof resolveDesktopLocalWorker>) {
    this.client = new LocalWorkerClient({ command });
  }
  dispose(): Promise<void> {
    return this.client.dispose();
  }
}
