import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { CoreTask } from '@neuralbridge/shared/core-api';
import { CoreClient, CoreClientError } from './src/core-client';
import { loadOrCreateDeviceIdentity } from './src/device-identity';
import { clearSession, loadSession, saveSession, type MobileSession } from './src/secure-store';
import type { DpopProof } from './src/core-client';
import { isTerminalTask, remoteTaskInput } from './src/task-actions';

const colors = { ink: '#041417', panel: '#0b2427', panelRaised: '#102f32', gold: '#d9b875', muted: '#9ab0ad', line: '#24484a', danger: '#ef9b86', success: '#9ed5b7' };
const APP_VERSION = '0.1.0';
type DeviceIdentity = { publicKey: { kty: 'EC'; crv: 'P-256'; x: string; y: string }; proof: DpopProof };
type PairingState = { id: string; state: string; pollAfterMs: number };
type MemoryResult = { id: string; title: string; summary: string | null; score: number | null };

export default function App() {
  const [endpoint, setEndpoint] = useState('https://core.ts.net');
  const [pairingCode, setPairingCode] = useState('');
  const [deviceName, setDeviceName] = useState('Meu Android');
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [session, setSession] = useState<MobileSession | null>(null);
  const [tasks, setTasks] = useState<CoreTask[]>([]);
  const [pairing, setPairing] = useState<PairingState | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [memories, setMemories] = useState<MemoryResult[]>([]);
  const [taskPrompt, setTaskPrompt] = useState('');
  const [busy, setBusy] = useState(true);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const disposed = useRef(false);
  const lastTaskEventId = useRef(0);

  useEffect(() => { disposed.current = false; void bootstrap(); return () => { disposed.current = true; }; }, []);
  const client = useMemo(() => identity && session ? new CoreClient({ endpoint, accessToken: session.accessToken, dpop: identity.proof }) : null, [endpoint, identity, session]);

  useEffect(() => {
    if (!session || !identity) return undefined;
    const timer = setInterval(() => { void loadTasks(session, identity, true); }, 10_000);
    return () => clearInterval(timer);
  }, [session, identity, endpoint]);

  useEffect(() => {
    if (!session || !identity || !client) return undefined;
    const controller = new AbortController();
    let stopped = false;
    const connect = async () => {
      while (!stopped) {
        try {
          await client.subscribeTasks((event) => { lastTaskEventId.current = event.id; void loadTasks(session, identity, true); }, controller.signal, lastTaskEventId.current);
        } catch (cause) {
          if (!stopped && !(cause instanceof DOMException && cause.name === 'AbortError')) setError(messageFor(cause));
        }
        if (!stopped) await wait(2_000);
      }
    };
    void connect();
    return () => { stopped = true; controller.abort(); };
  }, [client, session, identity]);

  async function bootstrap() {
    setBusy(true); setError(null);
    try {
      const [stored, device] = await Promise.all([loadSession(), loadOrCreateDeviceIdentity()]);
      if (disposed.current) return;
      setIdentity(device); setSession(stored);
      if (stored) await loadTasks(stored, device);
    } catch (cause) { setError(messageFor(cause)); }
    finally { if (!disposed.current) setBusy(false); }
  }

  async function loadTasks(current = session, device = identity, silent = false) {
    if (!current || !device) return;
    if (!silent) { setAction('refresh'); setError(null); }
    try {
      const result = await new CoreClient({ endpoint, accessToken: current.accessToken, dpop: device.proof }).listTasks();
      if (!disposed.current) setTasks(result);
    } catch (cause) {
      if (cause instanceof CoreClientError && cause.status === 401) {
        try {
          const next = await new CoreClient({ endpoint, dpop: device.proof }).exchangeToken({ grantType: 'refresh_token', refreshToken: current.refreshToken });
          const renewed = { accessToken: next.accessToken, refreshToken: next.refreshToken, deviceId: next.deviceId };
          await saveSession(renewed); setSession(renewed);
          const result = await new CoreClient({ endpoint, accessToken: renewed.accessToken, dpop: device.proof }).listTasks();
          if (!disposed.current) setTasks(result);
        } catch (refreshError) { setError(messageFor(refreshError)); }
      } else setError(messageFor(cause));
    } finally { if (!disposed.current && !silent) setAction(null); }
  }

  async function createTask() {
    if (!client || !taskPrompt.trim()) return;
    setAction('create'); setError(null);
    try {
      const result = await client.createTask(remoteTaskInput(taskPrompt));
      setTasks((current) => [result.task, ...current.filter((item) => item.id !== result.task.id)]);
      setTaskPrompt('');
      setNotice(result.replayed ? 'A tarefa já existia no Core; estado recuperado.' : 'Tarefa enviada ao Core.');
    } catch (cause) { setError(messageFor(cause)); }
    finally { if (!disposed.current) setAction(null); }
  }

  async function continueTask(task: CoreTask, prompt: string) {
    if (!client || !prompt.trim()) return;
    setAction(`continue:${task.id}`); setError(null);
    try {
      const result = await client.continueTask(task.id, prompt.trim());
      setTasks((current) => [result.task, ...current.filter((item) => item.id !== result.task.id)]);
      setNotice(result.replayed ? 'A continuação já existia no Core; estado recuperado.' : 'Continuação enviada ao Core.');
    } catch (cause) { setError(messageFor(cause)); }
    finally { if (!disposed.current) setAction(null); }
  }

  async function signOut() {
    await clearSession();
    setSession(null); setTasks([]); setMemories([]); setNotice('Sessão removida deste dispositivo.'); setError(null);
  }

  async function startPairing() {
    if (!identity) return;
    const code = pairingCode.trim().toUpperCase();
    if (code.length !== 8) { setError('Informe o código de 8 caracteres mostrado no Desktop.'); return; }
    setAction('pair'); setError(null); setNotice(null);
    try {
      const result = await new CoreClient({ endpoint, dpop: identity.proof }).claimPairing({ code, deviceName: deviceName.trim() || 'Dispositivo Android', platform: Platform.OS === 'ios' ? 'ios' : 'android', appVersion: APP_VERSION, publicKey: identity.publicKey });
      setPairing({ id: result.pairingId, state: result.status, pollAfterMs: result.pollAfterMs });
      await waitForApproval(result.pairingId, result.pollAfterMs, identity);
    } catch (cause) { setError(messageFor(cause)); setPairing(null); }
    finally { if (!disposed.current) setAction(null); }
  }

  async function waitForApproval(pairingId: string, delayMs: number, device: DeviceIdentity) {
    for (let attempt = 0; attempt < 60 && !disposed.current; attempt += 1) {
      await wait(delayMs);
      const status = await new CoreClient({ endpoint, dpop: device.proof }).pairingStatus(pairingId);
      setPairing({ id: pairingId, state: status.state, pollAfterMs: delayMs });
      if (status.state === 'approved' && status.deviceId) {
        const tokens = await new CoreClient({ endpoint, dpop: device.proof }).exchangeToken({ grantType: 'pairing', pairingId });
        const next = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, deviceId: tokens.deviceId };
        await saveSession(next); setSession(next); setPairing(null); setNotice('Dispositivo pareado com aprovação do Desktop.'); await loadTasks(next, device); return;
      }
      if (['rejected', 'expired', 'burned'].includes(status.state)) throw new Error(`O pareamento foi ${status.state === 'rejected' ? 'recusado' : 'encerrado'}.`);
    }
    if (!disposed.current) throw new Error('A aprovação demorou demais. Gere um novo código no Desktop.');
  }

  async function runTaskAction(task: CoreTask, kind: 'approve' | 'reject' | 'cancel') {
    if (!client) return;
    setAction(`${kind}:${task.id}`); setError(null);
    try {
      const next = kind === 'approve' || kind === 'reject' ? await client.approveTask(task.id, kind, kind === 'reject' ? 'Recusado no Companion Mobile.' : undefined) : await client.cancelTask(task.id, 'Cancelado no Companion Mobile.');
      setTasks((current) => current.map((item) => item.id === next.id ? next : item));
    } catch (cause) { setError(messageFor(cause)); }
    finally { if (!disposed.current) setAction(null); }
  }

  async function searchMemories() {
    if (!client || !searchQuery.trim()) return;
    setAction('search'); setError(null);
    try { const result = await client.searchMemories(searchQuery.trim()); setMemories(result.hits.map((item) => ({ id: item.id, title: item.title, summary: item.snippet, score: item.score }))); }
    catch (cause) { setError(messageFor(cause)); }
    finally { if (!disposed.current) setAction(null); }
  }

  return <SafeAreaView style={styles.safe}><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.header}><Text style={styles.kicker}>SINGULARITY / MOBILE</Text><Text style={styles.title}>Void, em movimento.</Text><Text style={styles.subtitle}>Acompanhe o Core sem levar o executor para o telefone.</Text></View>
    <View style={styles.orbit} accessibilityLabel="Conexão remota com o Singularity Core"><View style={styles.blackHole} /><View style={styles.accretion} /><Text style={styles.orbitLabel}>{session ? 'CORE CONECTADO' : 'CORE REMOTO'}</Text></View>
    {notice && <Text style={styles.notice} accessibilityRole="alert">{notice}</Text>}
    {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
    {busy ? <ActivityIndicator color={colors.gold} style={styles.loader} /> : session ? <>
      <View style={styles.panel}><View style={styles.rowBetween}><View><Text style={styles.panelTitle}>Tarefas do Core</Text><Text style={styles.caption}>Dispositivo {session.deviceId} · atualização a cada 10 s</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Encerrar sessão deste dispositivo" disabled={action !== null} onPress={() => void signOut()} style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}><Text style={styles.smallButtonText}>Sair</Text></Pressable></View>
        <View style={styles.composer}><TextInput value={taskPrompt} onChangeText={setTaskPrompt} placeholder="Pedir algo ao Core (somente leitura)" placeholderTextColor={colors.muted} style={[styles.input, styles.composerInput]} multiline accessibilityLabel="Pedido para o Core" /><Pressable accessibilityRole="button" accessibilityLabel="Enviar pedido ao Core" disabled={!taskPrompt.trim() || action !== null} onPress={() => void createTask()} style={({ pressed }) => [styles.searchButton, !taskPrompt.trim() && styles.disabled, pressed && styles.pressed]}><Text style={styles.buttonText}>{action === 'create' ? 'Enviando…' : 'Enviar'}</Text></Pressable></View>
        {tasks.length ? tasks.map((task) => <TaskCard key={task.id} task={task} busy={action !== null} onAction={(kind) => void runTaskAction(task, kind)} onContinue={(prompt) => void continueTask(task, prompt)} />) : <Text style={styles.empty}>Nenhuma tarefa visível para este dispositivo.</Text>}
      </View>
      <View style={styles.panel}><Text style={styles.panelTitle}>Memória do Core</Text><Text style={styles.caption}>Busca híbrida real, sem copiar o banco para o telefone.</Text><View style={styles.searchRow}><TextInput value={searchQuery} onChangeText={setSearchQuery} onSubmitEditing={() => void searchMemories()} placeholder="Buscar uma memória" placeholderTextColor={colors.muted} style={[styles.input, styles.searchInput]} returnKeyType="search" accessibilityLabel="Buscar memórias" /><Pressable accessibilityRole="button" accessibilityLabel="Buscar memórias" disabled={!searchQuery.trim() || action !== null} onPress={() => void searchMemories()} style={({ pressed }) => [styles.searchButton, pressed && styles.pressed]}><Text style={styles.buttonText}>Buscar</Text></Pressable></View>{memories.map((memory) => <View key={memory.id} style={styles.memory}><Text style={styles.taskTitle}>{memory.title}</Text><Text style={styles.taskMeta}>{memory.summary ?? 'Sem resumo'}{memory.score === null ? '' : ` · ${Math.round(memory.score * 100)}%`}</Text></View>)}</View>
    </> : <View style={styles.panel}><Text style={styles.panelTitle}>{pairing ? 'Aguardando aprovação' : 'Pareie este dispositivo'}</Text><Text style={styles.caption}>{pairing ? `Confirme o dispositivo no Desktop. Estado: ${pairing.state}.` : 'Leia o QR no Desktop ou digite o código de pareamento. O Core só cria a sessão após aprovação local.'}</Text>{!pairing && <><TextInput value={endpoint} onChangeText={setEndpoint} placeholder="https://seu-core.ts.net" placeholderTextColor={colors.muted} style={styles.input} autoCapitalize="none" keyboardType="url" accessibilityLabel="Endereço privado do Core" /><TextInput value={deviceName} onChangeText={setDeviceName} placeholder="Nome deste dispositivo" placeholderTextColor={colors.muted} style={styles.input} accessibilityLabel="Nome deste dispositivo" /><TextInput value={pairingCode} onChangeText={setPairingCode} placeholder="Código de 8 caracteres" placeholderTextColor={colors.muted} style={styles.input} autoCapitalize="characters" maxLength={8} accessibilityLabel="Código de pareamento" /></>}{pairing ? <ActivityIndicator color={colors.gold} style={styles.loader} /> : <Pressable accessibilityRole="button" disabled={action !== null} onPress={() => void startPairing()} style={({ pressed }) => [styles.button, action !== null && styles.disabled, pressed && styles.pressed]}><Text style={styles.buttonText}>{action === 'pair' ? 'Conectando…' : 'Parear com o Desktop'}</Text></Pressable>}</View>}
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

function TaskCard({ task, busy, onAction, onContinue }: { task: CoreTask; busy: boolean; onAction: (kind: 'approve' | 'reject' | 'cancel') => void; onContinue: (prompt: string) => void }) {
  const [prompt, setPrompt] = useState('');
  const approval = task.status === 'awaiting_approval';
  const cancellable = ['pending', 'planning', 'running', 'awaiting_approval', 'validating', 'paused'].includes(task.status);
  return <View style={styles.task}><Text style={styles.taskTitle}>{task.summary ?? task.prompt}</Text><Text style={styles.taskMeta}>{task.status} · {task.agents.join(', ') || 'Core'}</Text><View style={styles.taskActions}>{approval && <><Pressable accessibilityRole="button" disabled={busy} onPress={() => onAction('approve')} style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}><Text style={styles.actionText}>Aprovar</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={() => onAction('reject')} style={({ pressed }) => [styles.actionButton, styles.rejectButton, pressed && styles.pressed]}><Text style={styles.actionText}>Recusar</Text></Pressable></>}{cancellable && <Pressable accessibilityRole="button" disabled={busy} onPress={() => onAction('cancel')} style={({ pressed }) => [styles.actionButton, styles.rejectButton, pressed && styles.pressed]}><Text style={styles.actionText}>Cancelar</Text></Pressable>}</View>{isTerminalTask(task.status) && <View style={styles.continue}><TextInput value={prompt} onChangeText={setPrompt} placeholder="Continuar esta tarefa" placeholderTextColor={colors.muted} style={[styles.input, styles.continueInput]} accessibilityLabel={`Continuação da tarefa ${task.id}`} /><Pressable accessibilityRole="button" disabled={!prompt.trim() || busy} onPress={() => { onContinue(prompt); setPrompt(''); }} style={({ pressed }) => [styles.actionButton, !prompt.trim() && styles.disabled, pressed && styles.pressed]}><Text style={styles.actionText}>Continuar</Text></Pressable></View>}</View>;
}

function wait(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function messageFor(cause: unknown): string { return cause instanceof CoreClientError ? `Core indisponível (${cause.status}).` : cause instanceof Error ? cause.message : 'Não foi possível concluir a operação.'; }

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.ink }, flex: { flex: 1 }, content: { padding: 24, gap: 18 }, header: { paddingTop: 18 }, kicker: { color: colors.gold, fontSize: 11, letterSpacing: 2.4 }, title: { color: '#f4f1e8', fontSize: 34, fontWeight: '300', marginTop: 12, letterSpacing: 0.4 }, subtitle: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: 8, maxWidth: 320 }, orbit: { height: 190, alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', borderRadius: 28, backgroundColor: '#061d20', borderWidth: 1, borderColor: colors.line }, blackHole: { width: 74, height: 74, borderRadius: 74, backgroundColor: '#010304', zIndex: 2 }, accretion: { position: 'absolute', width: 180, height: 48, borderRadius: 180, borderWidth: 7, borderColor: colors.gold, opacity: 0.72, transform: [{ rotate: '-16deg' }] }, orbitLabel: { position: 'absolute', bottom: 14, color: colors.muted, fontSize: 10, letterSpacing: 1.8 }, panel: { padding: 18, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 22 }, panelTitle: { color: '#f4f1e8', fontSize: 20, fontWeight: '500' }, caption: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 8 }, input: { marginTop: 14, minHeight: 48, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.line, color: '#f4f1e8', backgroundColor: colors.panelRaised }, loader: { marginVertical: 28 }, empty: { color: colors.muted, lineHeight: 20, paddingVertical: 28 }, error: { color: colors.danger, lineHeight: 20, padding: 12, borderRadius: 12, backgroundColor: '#321b1c' }, notice: { color: colors.success, lineHeight: 20, padding: 12, borderRadius: 12, backgroundColor: '#15342b' }, button: { alignItems: 'center', justifyContent: 'center', minHeight: 48, paddingVertical: 13, borderRadius: 12, backgroundColor: colors.gold, marginTop: 16 }, buttonText: { color: colors.ink, fontWeight: '700' }, disabled: { opacity: 0.5 }, pressed: { opacity: 0.72 }, rowBetween: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }, smallButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.gold }, smallButtonText: { color: colors.gold, fontWeight: '600' }, composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 14 }, composerInput: { flex: 1, maxHeight: 96, marginTop: 0 }, task: { marginTop: 14, padding: 14, borderRadius: 14, backgroundColor: colors.panelRaised, borderLeftWidth: 2, borderLeftColor: colors.gold }, taskTitle: { color: '#f4f1e8', fontSize: 14, lineHeight: 20 }, taskMeta: { color: colors.muted, marginTop: 5, fontSize: 12, lineHeight: 18 }, taskActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }, actionButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 13, borderRadius: 10, backgroundColor: colors.gold }, rejectButton: { backgroundColor: '#5a2d2d' }, actionText: { color: '#f4f1e8', fontSize: 13, fontWeight: '700' }, continue: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 10 }, continueInput: { flex: 1, marginTop: 0, minHeight: 44, maxHeight: 80 }, searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, searchInput: { flex: 1 }, searchButton: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.gold }, memory: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line } });
