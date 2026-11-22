/** Kept free of engine imports, so that an app's main process can use it without loading the renderer. */

/** Fits a composition into `longEdge` without enlarging it. H.264 needs even sides. */
export function mogrtOutputSize(width: number, height: number, longEdge: number): { width: number; height: number } {
	const scale = Math.min(1, longEdge / Math.max(width, height));
	const even = (side: number): number => Math.max(2, Math.round((side * scale) / 2) * 2);
	return { width: even(width), height: even(height) };
}
