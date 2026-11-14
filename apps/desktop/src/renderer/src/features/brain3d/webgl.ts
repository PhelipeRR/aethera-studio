/** Checks for WebGL before mounting the scene, so a missing GPU path shows an alternative, not a blank page. */
export function webglSupport(): { ok: true; version: 1 | 2 } | { ok: false } {
  try {
    const canvas = document.createElement('canvas');
    const gl2 = canvas.getContext('webgl2');
    if (gl2) {
      gl2.getExtension('WEBGL_lose_context')?.loseContext();
      return { ok: true, version: 2 };
    }
    const gl1 = canvas.getContext('webgl');
    if (gl1) {
      gl1.getExtension('WEBGL_lose_context')?.loseContext();
      return { ok: true, version: 1 };
    }
  } catch {
    // Treated as unavailable.
  }
  return { ok: false };
}
