/** State of the MOGRT page. It lives outside the component, so that leaving the page doesn't lose a render. */

import type {
	MogrtBridge,
	MogrtMediaSlot,
	MogrtProgress,
	MogrtReply,
	MogrtRenderResult,
	MogrtTemplate,
	MogrtValue,
} from './mogrt-studio-contract';

export interface MogrtStudioState {
	template: MogrtTemplate | null;
	values: Record<string, MogrtValue>;
	media: Partial<Record<MogrtMediaSlot, string>>;
	tSec: number;
	longEdge: number;
	/** Bumped by every change to what a render would show. */
	edit: number;
	preview: { path: string; edit: number; tSec: number } | null;
	previewing: boolean;
	previewError: string | null;
	task: 'import' | 'render' | null;
	progress: (MogrtProgress & { secondsLeft: number | null }) | null;
	cancelling: boolean;
	result: (MogrtRenderResult & { edit: number }) | null;
	savedTo: string | null;
	error: string | null;
}

let state: MogrtStudioState = {
	template: null,
	values: {},
	media: {},
	tSec: 0,
	longEdge: 1280,
	edit: 0,
	preview: null,
	previewing: false,
	previewError: null,
	task: null,
	progress: null,
	cancelling: false,
	result: null,
	savedTo: null,
	error: null,
};
const listeners = new Set<() => void>();

export const subscribe = (listener: () => void): (() => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};
export const getState = (): MogrtStudioState => state;

function set(patch: Partial<MogrtStudioState>): void {
	state = { ...state, ...patch };
	for (const listener of listeners) listener();
}

const PREVIEW_DELAY_MS = 450;
let previewTimer: ReturnType<typeof setTimeout> | undefined;
let previewJob: Promise<void> | null = null;

function bridge(): MogrtBridge {
	const found = (window as unknown as { aetheraBridge?: { mogrt?: MogrtBridge } }).aetheraBridge?.mogrt;
	if (!found) throw new Error('Os templates MOGRT só funcionam no Aethera desktop.');
	return found;
}

async function call<T>(request: (api: MogrtBridge) => Promise<MogrtReply<T>>): Promise<T> {
	const reply = await request(bridge());
	if (!reply.ok) throw new Error(reply.message);
	return reply.value;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function schedulePreview(): void {
	clearTimeout(previewTimer);
	previewTimer = setTimeout(() => void runPreview(), PREVIEW_DELAY_MS);
}

async function runPreview(): Promise<void> {
	const { template, task, values, tSec, edit } = state;
	// A running preview schedules the next one when the picture it made is already stale.
	if (!template || task || previewJob) return;
	set({ previewing: true, previewError: null });
	previewJob = (async () => {
		try {
			const { path } = await call((api) => api.preview({ id: template.id, values, tSec }));
			if (state.template === template) set({ preview: { path, edit, tSec } });
		} catch (error) {
			// Starting another task cancels the preview. That is not a failure.
			if (!state.task) set({ previewError: messageOf(error) });
		}
	})();
	await previewJob;
	previewJob = null;
	set({ previewing: false });
	if (state.edit !== edit || state.tSec !== tSec) schedulePreview();
}

/** The main process runs one job at a time, and the preview gives way. */
async function stopPreview(): Promise<void> {
	clearTimeout(previewTimer);
	if (!previewJob) return;
	await call((api) => api.cancel());
	await previewJob;
}

function changed(patch: Partial<MogrtStudioState>): void {
	set({ ...patch, edit: state.edit + 1, previewError: null });
	schedulePreview();
}

export async function importTemplate(): Promise<void> {
	if (state.task) return;
	set({ task: 'import', error: null });
	try {
		await stopPreview();
		const template = await call((api) => api.importTemplate());
		if (template) {
			set({
				template,
				values: {},
				media: {},
				// The end card, where the logo and the text are both on screen.
				tSec: Math.round(template.durationSec * 7.5) / 10,
				edit: state.edit + 1,
				preview: null,
				previewError: null,
				result: null,
				savedTo: null,
			});
		}
	} catch (error) {
		set({ error: messageOf(error) });
	}
	set({ task: null });
	schedulePreview();
}

export function setValue(name: string, value: MogrtValue): void {
	changed({ values: { ...state.values, [name]: value } });
}

export function resetValues(): void {
	changed({ values: {} });
}

export function setTime(tSec: number): void {
	set({ tSec, previewError: null });
	schedulePreview();
}

export function setLongEdge(longEdge: number): void {
	set({ longEdge });
}

export async function pickMedia(slot: MogrtMediaSlot): Promise<void> {
	const { template } = state;
	if (!template) return;
	set({ error: null });
	try {
		const name = await call((api) => api.pickMedia({ id: template.id, slot }));
		if (name && state.template === template) changed({ media: { ...state.media, [slot]: name } });
	} catch (error) {
		set({ error: messageOf(error) });
	}
}

export async function clearMedia(slot: MogrtMediaSlot): Promise<void> {
	const { template } = state;
	if (!template) return;
	set({ error: null });
	try {
		await call((api) => api.clearMedia({ id: template.id, slot }));
		const media = { ...state.media };
		delete media[slot];
		changed({ media });
	} catch (error) {
		set({ error: messageOf(error) });
	}
}

export function retryPreview(): void {
	void runPreview();
}

export async function renderVideo(): Promise<void> {
	const { template, values, longEdge, edit } = state;
	if (!template || state.task) return;
	set({ task: 'render', progress: null, cancelling: false, result: null, savedTo: null, error: null });
	let unsubscribe: (() => void) | undefined;
	try {
		await stopPreview();
		// Cancel can be pressed while the preview is still stopping.
		if (!state.cancelling) {
			let first: { at: number; done: number } | undefined;
			unsubscribe = bridge().onProgress(({ done, total }) => {
				first ??= { at: Date.now(), done };
				const perFrame = done > first.done ? (Date.now() - first.at) / (done - first.done) : null;
				// The first frames decode the project and say little about the rest.
				const secondsLeft = perFrame !== null && done >= 10 ? ((total - done) * perFrame) / 1000 : null;
				set({ progress: { done, total, secondsLeft } });
			});
			const result = await call((api) => api.render({ id: template.id, values, longEdge }));
			set({ result: { ...result, edit } });
		}
	} catch (error) {
		if (!state.cancelling) set({ error: messageOf(error) });
	}
	unsubscribe?.();
	set({ task: null, progress: null, cancelling: false });
	if (state.preview?.edit !== state.edit || state.preview.tSec !== state.tSec) schedulePreview();
}

export async function cancelRender(): Promise<void> {
	set({ cancelling: true });
	try {
		await call((api) => api.cancel());
	} catch (error) {
		set({ cancelling: false, error: messageOf(error) });
	}
}

export async function saveVideo(): Promise<void> {
	const { result } = state;
	if (!result) return;
	set({ error: null });
	try {
		const savedTo = await call((api) => api.saveRender({ renderId: result.renderId }));
		if (savedTo) set({ savedTo });
	} catch (error) {
		set({ error: messageOf(error) });
	}
}

export async function revealVideo(): Promise<void> {
	const { result } = state;
	if (!result) return;
	try {
		await call((api) => api.revealRender({ renderId: result.renderId }));
	} catch (error) {
		set({ error: messageOf(error) });
	}
}
