import * as React from 'react';
import { AlertTriangle, Box, CheckCircle2, ChevronDown, CircleAlert, Clock, Code2, ExternalLink, Folder, Info, Layers, List, Minus, Music2, Pin, PinOff, RotateCcw, Settings2, Sparkles, Target, Terminal, X, type LucideIcon } from 'lucide-react';
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation, m, useIsPresent, useReducedMotion, useSpring, type Variants } from 'motion/react';
import type { CompanionEvent, CompanionHudLayout, CompanionHudMode, CompanionHudState, CompanionSession } from '@neuralbridge/shared/companion';
import type { SpotifyPlayback } from '@neuralbridge/shared/spotify';
import { AGENT_LABELS, STATUS_LABELS, formatDuration, isActive, mascotState, primarySession, resolveMascotState, timeline, type TimelineTone, DOZE_AFTER_MS, dozing, type MascotReaction, type MascotState } from './companion-state';
import { bubblePlacement, HUD_MS, HUD_SPRING, hudTargets, hudTransition } from './companion-motion';
import { NeuralBridgeMascot } from './NeuralBridgeMascot';
import { useCompanionFeed, useNow, usePageVisible, useTaskFacts, type TaskFacts } from './useCompanionFeed';
import { useHudClickThrough, useHudDrag } from './useHudPointer';
import { SpotifyPlayer } from './SpotifyPlayer';
import { useSpotify } from './useSpotify';
import { NeuraChat } from '@/features/neura/NeuraChat';
import { NeuraPanel } from '@/features/neura/NeuraPanel';
import { NeuraReplyBubble, NeuraSuggestionBubble, NeuraThinkingBubble } from '@/features/neura/NeuraSuggestionBubble';
import { neuraActivity, neuraBadge, neuraMascot, pendingSuggestions, neuraWaitLabel } from '@/features/neura/neura-state';
import { useNeura, useSpeaking } from '@/features/neura/useNeura';
import { useNeuraVoiceOutput } from '@/features/neura/useNeuraVoiceOutput';
import { useMeetingCapture } from '@/features/neura/useMeetingCapture';
import { useVoiceCapture } from '@/features/neura/useVoiceCapture';

/** The pause that lets content leave before the shape closes around it. An interrupted spring skips it and keeps its speed. */
const CONTRACTION_DELAY_S = .04;
const EXIT_S = .1;
const STAGGER_S = .03;
const ENTRY_DELAY_S = .06;
const CONTENT_OFFSET_PX = 6;
const REDUCED_FADE_S = .08;
const HEARING_CUE_LEFT = 2;
const HEARING_CUE_TOP = 86;
const SESSION_OFFSET_PX = 12;
const SESSION_ROW_PX = 64;
const EVENT_OFFSET_PX = 4;
const TILT_SPRING = { stiffness: 300, damping: 20, mass: .6 };
const AGENT_ICONS = { claude: Terminal, codex: Code2, opencode: Box };
const TONE_ICONS: Record<TimelineTone, LucideIcon> = { ok: CheckCircle2, info: Info, warn: CircleAlert, error: AlertTriangle };

function initialMode(): CompanionHudMode {
  const mode = new URLSearchParams(window.location.search).get('mode');
  return mode === 'compact' || mode === 'expanded' ? mode : 'mascot';
}
/** From the URL, so the first frame has the mascot in place. A missing value only costs a corner until the state arrives. */
function initialLayout(): CompanionHudLayout {
  try { return JSON.parse(new URLSearchParams(window.location.search).get('layout') ?? '') as CompanionHudLayout; }
  catch { return { origin: { x: 0, y: 0 }, mascot: { x: 0, y: 0 }, compact: { x: 0, y: 0 }, side: 'left' }; }
}

function contentVariants(reduced: boolean): Variants {
  return {
    hidden: { opacity: 0, y: reduced ? 0 : CONTENT_OFFSET_PX, transition: { duration: reduced ? REDUCED_FADE_S : EXIT_S } },
    shown: { opacity: 1, y: 0, transition: { duration: reduced ? REDUCED_FADE_S : HUD_MS.content / 1000, delayChildren: reduced ? 0 : ENTRY_DELAY_S, staggerChildren: reduced ? 0 : STAGGER_S } },
  };
}

/** The next session comes from the side the list moved towards, so the panel reads as one thing turning a page. */
function sessionVariants(reduced: boolean): Variants {
  const transition = { duration: reduced ? REDUCED_FADE_S : HUD_MS.session / 1000, ease: 'easeOut' } as const;
  const offset = (step: number) => (reduced ? 0 : step * SESSION_OFFSET_PX);
  return { enter: (step: number) => ({ opacity: 0, x: offset(step) }), shown: { opacity: 1, x: 0, transition }, leave: (step: number) => ({ opacity: 0, x: offset(-step), transition }) };
}

/** Content on its way out stays in place to fade, but no longer takes clicks or keyboard focus. */
function HudContent({ className, reduced, children }: { className: string; reduced: boolean; children: React.ReactNode }) {
  const present = useIsPresent();
  return <m.div className={className} variants={contentVariants(reduced)} initial="hidden" animate="shown" exit="hidden" inert={!present}>{children}</m.div>;
}

function StatusDot({ session }: { session: CompanionSession | null }) {
  const tone = !session || session.connection === 'disconnected' ? 'off' : session.connection === 'degraded' ? 'warn' : isActive(session) ? 'live' : 'off';
  return <span className={`companion-dot companion-dot--${tone}`} aria-hidden="true" />;
}

function Waveform({ active }: { active: boolean }) {
  return <span className={`companion-wave ${active ? 'companion-wave--active' : ''}`} aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <i key={index} />)}</span>;
}

function connectionLabel(session: CompanionSession | null, available: boolean): string {
  if (!available) return 'Registro indisponível';
  if (!session) return 'Observando o TaskEngine';
  return session.connection === 'connected' ? 'Conectado' : session.connection === 'degraded' ? 'Conexão degradada' : 'Desconectado';
}

function Capsule({ session, facts, activeCount, available, music, neuraLabel, onExpand }: { session: CompanionSession | null; facts: TaskFacts | undefined; activeCount: number; available: boolean; music: SpotifyPlayback | null; neuraLabel: string | null; onExpand: () => void }) {
  // Agents keep the capsule while they work; music takes it only when none is active.
  const showMusic = activeCount === 0 && available && music !== null;
  const title = activeCount > 1 ? `${activeCount} agentes ativos` : session ? AGENT_LABELS[session.agent] : 'Nenhum agente ativo';
  const detail = !available ? 'Registro indisponível' : session ? [STATUS_LABELS[session.status], facts?.project].filter(Boolean).join(' • ') : 'Em espera';
  return <>
    <span className="companion-capsule__rule" aria-hidden="true" />
    <span className="companion-capsule__copy" role="status"><strong>{showMusic ? <Music2 className="size-4 shrink-0 text-[var(--hud-live)]" aria-hidden="true" /> : <StatusDot session={session} />}<AnimatePresence mode="wait" initial={false}><m.span key={showMusic ? music.trackId ?? music.title : title} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: HUD_MS.micro / 1000 }}>{showMusic ? music.title : title}</m.span></AnimatePresence></strong>{neuraLabel ? <span className="companion-capsule__neura" data-testid="neura-badge">{neuraLabel}</span> : <span>{showMusic ? music.artists || (music.isPlaying ? 'Tocando' : 'Pausado') : detail}</span>}</span>
    {/* A flat wave says nothing, and its width is what keeps the longest title whole. */}
    {(showMusic ? music.isPlaying : session?.status === 'running' && session.connection === 'connected') && <Waveform active />}
    <button type="button" className="companion-capsule__toggle" onClick={onExpand} aria-label="Expandir Companion"><ChevronDown className="size-5" aria-hidden="true" /></button>
  </>;
}

function SessionRow({ session, facts, selected, onSelect }: { session: CompanionSession; facts: TaskFacts | undefined; selected: boolean; onSelect: () => void }) {
  const Icon = AGENT_ICONS[session.agent];
  return <button type="button" className={`companion-session ${selected ? 'companion-session--selected' : ''}`} onClick={onSelect} aria-pressed={selected}>
    <span className={`companion-session__icon companion-session__icon--${session.agent}`}><Icon className="size-[18px]" aria-hidden="true" /></span>
    <span className="companion-session__copy"><strong>{AGENT_LABELS[session.agent]}</strong><span>{facts?.project ?? STATUS_LABELS[session.status]}</span></span>
    <StatusDot session={session} />
    <span className="sr-only">{STATUS_LABELS[session.status]}</span>
  </button>;
}

function Stat({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: number; tone: 'task' | 'ok' | 'warn' }) {
  return <div className="companion-stat"><Icon className={`companion-stat__icon companion-stat__icon--${tone}`} aria-hidden="true" /><span><small>{label}</small><strong>{value}</strong></span></div>;
}

function Details({ session, facts, sessions, now }: { session: CompanionSession | null; facts: TaskFacts | undefined; sessions: CompanionSession[]; now: number }) {
  if (!session) return <section className="companion-card companion-detail companion-detail--empty"><h1>Nenhum agente ativo</h1><p>O Companion está observando o TaskEngine.</p><p className="companion-muted">Sessões aparecem aqui quando uma tarefa começa.</p><MissionControlButton /></section>;
  const Icon = AGENT_ICONS[session.agent];
  const live = isActive(session) && session.connection === 'connected';
  return <section className="companion-card companion-detail" aria-labelledby="companion-detail-title">
    <header className="companion-detail__head">
      <span className={`companion-detail__icon companion-session__icon--${session.agent}`}><Icon className="size-6" aria-hidden="true" /></span>
      <div className="min-w-0"><h1 id="companion-detail-title">{AGENT_LABELS[session.agent]}</h1><p><Folder className="size-4 shrink-0" aria-hidden="true" /><span>{facts?.project ?? session.projectId ?? 'Sem projeto'}</span></p></div>
      <span className={`companion-pill companion-pill--${live ? 'live' : session.status === 'failed' ? 'error' : 'idle'}`}>{STATUS_LABELS[session.status]}</span>
    </header>
    <div className="companion-detail__task"><Target className="size-4 shrink-0" aria-hidden="true" /><span title={facts?.title}>{facts?.title ?? `Tarefa ${session.taskId.slice(0, 8)}`}</span><Clock className="ml-auto size-4 shrink-0" aria-hidden="true" /><time>{formatDuration(session, now)}</time></div>
    <div className="companion-stats">
      <Stat icon={Layers} label="Tarefas" value={new Set(sessions.map((item) => item.taskId)).size} tone="task" />
      <Stat icon={CheckCircle2} label="Concluídas" value={sessions.filter((item) => item.status === 'completed').length} tone="ok" />
      <Stat icon={AlertTriangle} label="Erros" value={sessions.filter((item) => item.status === 'failed').length} tone="warn" />
    </div>
    <MissionControlButton />
  </section>;
}

function MissionControlButton() {
  return <button type="button" className="companion-cta" onClick={() => void window.neuralbridge.app.openMissionControl()}><ExternalLink className="size-[18px]" aria-hidden="true" /> Abrir Mission Control</button>;
}

/** Only what arrives while watching slides in: AnimatePresence leaves the list a session opens with as it is. */
function Events({ events }: { events: CompanionEvent[] }) {
  const items = timeline(events, 8);
  return <section className="companion-card companion-events" aria-labelledby="companion-events-title">
    <h2 id="companion-events-title"><List className="size-5" aria-hidden="true" /> Eventos recentes</h2>
    {items.length ? <ol data-hud-scroll><AnimatePresence initial={false}>{items.map((item) => { const Icon = TONE_ICONS[item.tone]; return <m.li key={item.id} initial={{ opacity: 0, y: -EVENT_OFFSET_PX }} animate={{ opacity: 1, y: 0 }} transition={{ duration: HUD_MS.content / 1000 }}><Icon className={`companion-events__icon companion-events__icon--${item.tone}`} aria-hidden="true" /><span title={item.label}>{item.label}</span><time>{new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></m.li>; })}</AnimatePresence></ol> : <p className="companion-muted">Nenhum evento recente para esta sessão.</p>}
  </section>;
}

const NEURA_REACTION_MS = 1_400;

/** A Neura request that failed earns the same "ops" face as a failed task, once per answer. */
function useNeuraReaction(neura: ReturnType<typeof useNeura>): MascotReaction | null {
  const [reaction, setReaction] = React.useState<MascotReaction | null>(null);
  const seen = React.useRef<string | null>(null);
  const response = neura?.lastResponse;
  React.useEffect(() => {
    if (!response || seen.current === response.correlationId) return;
    const first = seen.current === null;
    seen.current = response.correlationId;
    if (first || response.outcome !== 'failed') return;
    setReaction('error');
    const timer = setTimeout(() => setReaction(null), NEURA_REACTION_MS);
    return () => clearTimeout(timer);
  }, [response]);
  return reaction;
}

/** As long as the gateway waits for the request after "Neura". */
const CALLED_MS = 8_000;

function useWakeCount(): { wakes: number; called: boolean } {
  const [wakes, setWakes] = React.useState(0);
  const [called, setCalled] = React.useState(false);
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = window.neuralbridge.neura.onWake(() => {
      setWakes((count) => count + 1);
      setCalled(true);
      clearTimeout(timer);
      timer = setTimeout(() => setCalled(false), CALLED_MS);
    });
    return () => { stop(); clearTimeout(timer); };
  }, []);
  return { wakes, called };
}

/** A pointer over the HUD or a call wakes it; the timer restarts whenever the mascot had something else to show. */
function useDoze(state: MascotState, wakes: number): MascotState {
  const [asleepAt, setAsleepAt] = React.useState<string | null>(null);
  const [pokes, setPokes] = React.useState(0);
  const lastActivity = React.useRef(0);
  const asleep = React.useRef(false);
  const key = `${state}|${wakes}|${pokes}`;
  React.useEffect(() => {
    const poke = () => { lastActivity.current = Date.now(); if (asleep.current) setPokes((count) => count + 1); };
    window.addEventListener('mousemove', poke, { passive: true });
    return () => window.removeEventListener('mousemove', poke);
  }, []);
  React.useEffect(() => {
    asleep.current = false;
    if (state !== 'idle') return;
    lastActivity.current = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const idleFor = Date.now() - lastActivity.current;
      if (dozing(state, lastActivity.current, Date.now()) === 'resting') { asleep.current = true; setAsleepAt(key); }
      else timer = setTimeout(check, DOZE_AFTER_MS - idleFor);
    };
    timer = setTimeout(check, DOZE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [state, key]);
  return state === 'idle' && asleepAt === key ? 'resting' : state;
}

export function CompanionHud() {
  const [mode, setModeState] = React.useState(initialMode);
  const [layout, setLayout] = React.useState(initialLayout);
  const reduced = useReducedMotion() === true;
  const [pinned, setPinned] = React.useState(true);
  const [shown, setShown] = React.useState(true);
  const [chosenId, setChosenId] = React.useState<string | null>(null);
  const [view, setView] = React.useState<'agents' | 'neura'>('agents');
  const neura = useNeura();
  const { preparingVoice, silentReply, dismissReply } = useNeuraVoiceOutput(neura);
  const activity = neura ? neuraActivity(neura) : 'off';
  const voiceProvider = neura?.voice?.provider;
  const streamingVoice = voiceProvider === 'voicestudio-streaming';
  useVoiceCapture((voiceProvider === 'voicestudio-whisper' || streamingVoice) && neura?.voice != null, streamingVoice);
  const { sessions, events, available, reaction, loadEvents } = useCompanionFeed();
  const spotify = useSpotify();
  // A remembered track fills the player, but says nothing is playing: the mascot and the capsule stay out of it.
  const music = spotify?.connection === 'connected' && !spotify.playback?.remembered ? spotify.playback : null;
  const pageVisible = usePageVisible() && shown;
  const { dragging, held, tilt, handlers } = useHudDrag();
  const lean = useSpring(tilt, TILT_SPRING);
  const recheckPointer = useHudClickThrough(dragging);
  React.useEffect(() => { if (!held) recheckPointer(); }, [held, recheckPointer]);

  const primary = React.useMemo(() => primarySession(sessions), [sessions]);
  const selected = sessions.find((session) => session.sessionId === chosenId) ?? primary;
  const visibleSessions = React.useMemo(() => sessions.slice(0, 6), [sessions]);
  const factsFor = React.useMemo(() => (primary && !visibleSessions.includes(primary) ? [primary, ...visibleSessions] : visibleSessions), [primary, visibleSessions]);
  const facts = useTaskFacts(factsFor);
  const activeCount = sessions.filter(isActive).length;
  const now = useNow(mode === 'expanded' && pageVisible && ((selected !== null && isActive(selected)) || music?.isPlaying === true));
  const speaking = useSpeaking();
  const hearing = neura?.meeting?.capabilities.audio === true;
  useMeetingCapture(hearing, speaking);
  const neuraReaction = useNeuraReaction(neura);
  const { wakes, called } = useWakeCount();
  const awakeState = resolveMascotState({ available, speaking, reaction: reaction ?? neuraReaction, neura: neura && neuraMascot(neura, called), session: mascotState(primary), playback: music });
  const state = useDoze(awakeState, wakes);
  const selectedEvents = React.useMemo(() => events.filter((event) => event.sessionId === selected?.sessionId), [events, selected?.sessionId]);

  const selectedId = selected?.sessionId;
  React.useEffect(() => { if (mode === 'expanded' && selectedId) loadEvents(selectedId); }, [mode, selectedId, loadEvents]);
  /** A click outranks the answer to a question asked before it, so a slow first read cannot undo it. */
  const touched = React.useRef(false);
  React.useEffect(() => {
    let disposed = false;
    const apply = (value: CompanionHudState) => { setPinned(value.alwaysOnTop); setShown(value.visible); setLayout(value.layout); };
    void window.neuralbridge.companion.getHudState().then((value) => { if (disposed) return; apply(value); if (!touched.current) setModeState(value.mode); });
    const stop = window.neuralbridge.companion.onHudState((value) => { apply(value); setModeState(value.mode); });
    return () => { disposed = true; stop(); };
  }, []);

  /** The window no longer changes with the mode, so there is one target and nothing to sequence: a spring just turns around. */
  const setMode = React.useCallback((next: CompanionHudMode) => {
    touched.current = true;
    setModeState(next);
    void window.neuralbridge.companion.setHudMode(next);
  }, []);
  const selectedIndex = visibleSessions.findIndex((session) => session.sessionId === selected?.sessionId);
  const [sessionPage, setSessionPage] = React.useState({ index: selectedIndex, step: 1 });
  if (sessionPage.index !== selectedIndex) setSessionPage({ index: selectedIndex, step: selectedIndex >= sessionPage.index ? 1 : -1 });
  const sessionStep = sessionPage.step;
  const sessionSpring = reduced ? { duration: 0 } : { type: 'spring', ...HUD_SPRING.collapse } as const;
  const [turn, setTurn] = React.useState({ mode, from: mode });
  if (turn.mode !== mode) setTurn({ mode, from: turn.mode });
  const from = turn.mode === mode ? turn.from : turn.mode;
  const [moving, setMoving] = React.useState(false);
  const target = hudTargets(layout, mode);
  const { radius, surface, ...box } = target.shell;
  const collapsing = target.shell.width < hudTargets(layout, from).shell.width;
  // While dragged, the mascot is under the cursor: the window is what moves, and a spring here would only trail it.
  const transition = held ? { duration: 0 } : { ...hudTransition(from, mode, reduced), ...(collapsing && !moving && !reduced ? { delay: CONTRACTION_DELAY_S } : {}) };

  React.useEffect(() => {
    if (mode !== 'expanded') return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMode('compact'); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, setMode]);

  const waiting = neura ? pendingSuggestions(neura) : [];
  const suggestion = mode === 'expanded' ? undefined : waiting[0];
  const waitLabel = mode === 'expanded' || suggestion ? null : neuraWaitLabel(neura, preparingVoice);
  const mascotLabel = mode === 'mascot' ? 'Expandir Companion' : mode === 'compact' ? 'Recolher para o mascote' : 'Recolher Companion';
  const togglePin = () => { const next = !pinned; setPinned(next); void window.neuralbridge.companion.setHudPinned(next); };

  return <LazyMotion features={domAnimation}><MotionConfig reducedMotion="user"><main className={`companion-hud companion-hud--${mode} ${pageVisible ? '' : 'companion-hud--suspended'}`} data-hud-side={layout.side} aria-label="Singularity Companion" {...handlers}>
    <m.div className="companion-shell" initial={false} animate={{ ...box, borderRadius: radius }} transition={transition} onAnimationStart={() => setMoving(true)} onAnimationComplete={() => { setMoving(false); recheckPointer(); }} {...(mode === 'mascot' ? {} : { 'data-hud-hit': true })}>
      <m.div className="companion-surface" initial={false} animate={{ borderRadius: radius, opacity: surface }} transition={transition} />
      <m.div className="companion-content" initial={false} animate={{ borderRadius: radius }} transition={transition}>
      <AnimatePresence initial={false}>
      {mode === 'compact' && <HudContent key="capsule" className="companion-capsule" reduced={reduced}><Capsule session={primary} facts={primary ? facts[primary.taskId] : undefined} activeCount={activeCount} available={available} music={music} neuraLabel={neura ? neuraBadge(neura) : null} onExpand={() => setMode('expanded')} /></HudContent>}
      {mode === 'expanded' && <HudContent key="panel" className="companion-panel" reduced={reduced}>
        <m.header className="companion-panel__header" variants={contentVariants(reduced)}>
          <div className="companion-panel__title"><h1>Singularity <span>Companion</span></h1><p className={activeCount ? 'companion-panel__live' : ''}><StatusDot session={activeCount ? primary : null} />{!available ? connectionLabel(primary, available) : activeCount ? `${activeCount} ${activeCount === 1 ? 'agente ativo' : 'agentes ativos'} • ${connectionLabel(primary, available)}` : connectionLabel(primary, available)}</p></div>
          <div className="companion-panel__actions">
            {activity !== 'off' && <button type="button" onClick={() => setView(view === 'neura' ? 'agents' : 'neura')} aria-label="Void" aria-pressed={view === 'neura'} title="Painel do Void"><Sparkles className="size-5" aria-hidden="true" /></button>}
            <button type="button" className="companion-pin" onClick={togglePin} aria-label={pinned ? 'Desafixar Companion' : 'Fixar Companion'} aria-pressed={pinned} title={pinned ? 'Sempre visível' : 'Fixar acima das janelas'}>{pinned ? <Pin className="size-5" aria-hidden="true" /> : <PinOff className="size-5" aria-hidden="true" />}</button>
            <button type="button" onClick={() => void window.neuralbridge.companion.resetHudPosition()} aria-label="Restaurar posição padrão" title="Restaurar posição"><RotateCcw className="size-5" aria-hidden="true" /></button>
            <button type="button" onClick={() => void window.neuralbridge.companion.openSettings()} aria-label="Abrir configurações do Companion" title="Configurações"><Settings2 className="size-5" aria-hidden="true" /></button>
            <button type="button" onClick={() => setMode('compact')} aria-label="Minimizar para a cápsula" title="Minimizar"><Minus className="size-5" aria-hidden="true" /></button>
            <button type="button" onClick={() => void window.neuralbridge.companion.setHudVisibility(false)} aria-label="Ocultar Companion" title="Ocultar (reative em Configurações)"><X className="size-5" aria-hidden="true" /></button>
          </div>
        </m.header>
        <AnimatePresence mode="wait">
        {view === 'neura' && neura && activity !== 'off' ? <m.div key="neura" className="companion-panel__view" variants={contentVariants(reduced)} initial="hidden" animate="shown" exit="hidden"><NeuraPanel state={neura} /></m.div> : <m.div key="agents" className="companion-panel__body" variants={contentVariants(reduced)} initial="hidden" animate="shown" exit="hidden">
          <div className="companion-left">
          <nav className="companion-sessions" aria-label="Sessões" data-hud-scroll>{selectedIndex >= 0 && <m.span className="companion-session__marker" initial={false} animate={{ y: selectedIndex * SESSION_ROW_PX }} transition={sessionSpring} aria-hidden="true" />}{visibleSessions.length ? visibleSessions.map((session) => <SessionRow key={session.sessionId} session={session} facts={facts[session.taskId]} selected={session.sessionId === selected?.sessionId} onSelect={() => setChosenId(session.sessionId)} />) : <p className="companion-muted">Nenhuma sessão registrada.</p>}</nav>
          {spotify?.connection === 'connected' && <SpotifyPlayer status={spotify} now={now} />}
          </div>
          <div className="companion-detail-stage">
            <AnimatePresence initial={false} custom={sessionStep}>
              <m.div key={selected?.sessionId ?? 'none'} className="companion-detail-slide" custom={sessionStep} variants={sessionVariants(reduced)} initial="enter" animate="shown" exit="leave"><Details session={selected} facts={selected ? facts[selected.taskId] : undefined} sessions={sessions} now={now} /></m.div>
            </AnimatePresence>
          </div>
          <Events key={selected?.sessionId ?? 'none'} events={selectedEvents} />
        </m.div>}
        </AnimatePresence>
        {neura && activity !== 'off' && view !== 'neura' && <NeuraChat state={neura} />}
      </HudContent>}
      </AnimatePresence>
      </m.div>
    </m.div>
    <m.button type="button" className="companion-mascot" style={{ originX: 0, originY: 0 }} initial={false} animate={target.mascot} transition={transition} data-hud-hit data-hud-drag onClick={() => setMode(mode === 'mascot' ? 'compact' : mode === 'compact' ? 'mascot' : 'compact')} aria-label={mascotLabel} aria-expanded={mode !== 'mascot'}>
      <m.span className="companion-mascot__lean" style={{ rotate: reduced ? 0 : lean }}><NeuralBridgeMascot state={state} beat={music?.trackId ?? null} active={pageVisible && !reduced} wakes={wakes} rhythm={music} /></m.span>
    </m.button>
    {/* In every mode, and apart from the badge: what is being heard must show even when a suggestion takes the capsule's label. */}
    {hearing && <m.span className="companion-hearing" data-testid="hearing-cue" role="status" initial={false} animate={{ x: target.mascot.x + HEARING_CUE_LEFT, y: target.mascot.y + HEARING_CUE_TOP * target.mascot.scale }} transition={transition}>Ouvindo a call</m.span>}
    <AnimatePresence onExitComplete={recheckPointer}>
      {waitLabel && <NeuraThinkingBubble key="thinking" label={waitLabel} placement={bubblePlacement(layout)} reduced={reduced} />}
      {!waitLabel && !suggestion && mode !== 'expanded' && silentReply && <NeuraReplyBubble key={silentReply.id} text={silentReply.text} placement={bubblePlacement(layout)} reduced={reduced} onDismiss={dismissReply} />}
      {suggestion && <NeuraSuggestionBubble key={suggestion.suggestionId} suggestion={suggestion} waiting={waiting.length} placement={bubblePlacement(layout)} reduced={reduced} onOpen={() => { setView('neura'); setMode('expanded'); }} />}
    </AnimatePresence>
  </main></MotionConfig></LazyMotion>;
}
