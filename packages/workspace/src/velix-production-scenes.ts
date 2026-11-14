export type ProductionScene = { at: number; capitulo?: { n: number; titulo: string; cor: string }; fonte?: string; blocks?: unknown[]; blocos?: unknown[]; [key: string]: unknown };

export type ProductionSceneData = { serie?: string; rodape?: string; duracao?: number; cenas?: ProductionScene[]; [key: string]: unknown };

/** Adds editorial material using only block types supported by the existing Dossiê renderer. */
export function buildProductionScenes(data: ProductionSceneData, mode: 'commentary' | 'news', references: readonly string[] = []): ProductionSceneData {
  const scenes = Array.isArray(data.cenas) ? data.cenas : [];
  const source = references.length ? references.join(' · ') : undefined;
  const prefix = mode === 'commentary' ? 'Compilação comentada' : 'Noticiário verificável';
  const next = scenes.map((scene, index) => ({
    ...scene,
    ...(source && !scene.fonte ? { fonte: source } : {}),
    blocos: [...(Array.isArray(scene.blocos) ? scene.blocos : []), { tipo: 'nota', titulo: prefix, texto: source ?? 'Referência editorial vinculada ao roteiro.', cor: mode === 'news' ? 'azul' : 'amarelo', at: scene.at + 0.05, editorialScene: index }],
  }));
  return { ...data, cenas: next };
}
