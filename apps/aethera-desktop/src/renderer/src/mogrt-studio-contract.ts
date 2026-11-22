/** What the MOGRT page and the main process exchange. The page only ever sends ids, never paths. */

export type MogrtValue = string | number | boolean | number[];
export type MogrtMediaSlot = 'logo' | 'background';

export interface MogrtControl {
	name: string;
	kind: 'boolean' | 'number' | 'angle' | 'color' | 'point' | 'text' | 'scale';
	value: MogrtValue;
}

export interface MogrtTemplate {
	id: string;
	fileName: string;
	name: string;
	width: number;
	height: number;
	fps: number;
	durationSec: number;
	thumbnailPath: string | null;
	media: MogrtMediaSlot[];
	controls: MogrtControl[];
}

export interface MogrtEditRequest {
	id: string;
	/** Only the controls the user changed. */
	values: Record<string, MogrtValue>;
}

export interface MogrtPreviewRequest extends MogrtEditRequest {
	tSec: number;
}

export interface MogrtRenderRequest extends MogrtEditRequest {
	longEdge: number;
}

export interface MogrtRenderSummary {
	verdict: 'complete' | 'partial_with_documented_gaps' | 'failed';
	reason: string;
	effects: Array<{ layerName: string; name: string; reason: string }>;
	gaps: Array<{ layerName: string; reason: string }>;
	approximations: string[];
}

export interface MogrtRenderResult extends MogrtRenderSummary {
	renderId: string;
	path: string;
	width: number;
	height: number;
}

export interface MogrtProgress {
	done: number;
	total: number;
}

export type MogrtReply<T> = { ok: true; value: T } | { ok: false; message: string };

export const MOGRT_RESOLUTIONS = [640, 1280, 1920] as const;

export interface MogrtBridge {
	importTemplate: () => Promise<MogrtReply<MogrtTemplate | null>>;
	pickMedia: (input: { id: string; slot: MogrtMediaSlot }) => Promise<MogrtReply<string | null>>;
	clearMedia: (input: { id: string; slot: MogrtMediaSlot }) => Promise<MogrtReply<null>>;
	preview: (input: MogrtPreviewRequest) => Promise<MogrtReply<{ path: string }>>;
	render: (input: MogrtRenderRequest) => Promise<MogrtReply<MogrtRenderResult>>;
	cancel: () => Promise<MogrtReply<null>>;
	saveRender: (input: { renderId: string }) => Promise<MogrtReply<string | null>>;
	revealRender: (input: { renderId: string }) => Promise<MogrtReply<null>>;
	onProgress: (listener: (progress: MogrtProgress) => void) => () => void;
}
