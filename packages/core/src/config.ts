import { resolveDataDir } from '@neuralbridge/shared';

/*
 * CORE-03: configuration comes from the environment only, so the same entry runs as an Electron child today
 * (ELECTRON_RUN_AS_NODE=1) and as a standalone Node process in CORE-08, with no Electron import anywhere.
 */

export type CoreMode = 'embedded' | 'standalone';

export interface CoreConfig {
  dataDir: string;
  mode: CoreMode;
  /** Preferred loopback port; null = dynamic. When taken, the Core falls back to a dynamic port. */
  preferredPort: number | null;
  version: string;
  /** Test hook, honoured only when NB_CORE_ALLOW_TEST_HOOKS=1 (never set by the packaged app). */
  testCrash: 'startup' | 'after-ready' | null;
}

export class CoreConfigError extends Error {}

export function readCoreConfig(env: Record<string, string | undefined>): CoreConfig {
  const mode = env['NB_CORE_MODE'] ?? 'embedded';
  if (mode !== 'embedded' && mode !== 'standalone') throw new CoreConfigError(`NB_CORE_MODE inválido: ${mode}`);
  // Standalone is prepared but not offered yet (CORE-08); refusing it keeps this lot from creating an unsupervised Core.
  if (mode === 'standalone' && env['NB_CORE_ALLOW_STANDALONE'] !== '1') throw new CoreConfigError('O modo independente ainda não está habilitado (CORE-08).');
  const rawPort = env['NB_CORE_PORT'];
  let preferredPort: number | null = null;
  if (rawPort !== undefined && rawPort !== '') {
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new CoreConfigError('NB_CORE_PORT deve ser um inteiro entre 1024 e 65535.');
    preferredPort = port;
  }
  const hooks = env['NB_CORE_ALLOW_TEST_HOOKS'] === '1';
  const crash = env['NB_CORE_TEST_CRASH'];
  return {
    dataDir: resolveDataDir(env),
    mode,
    preferredPort,
    version: env['NB_CORE_VERSION'] && /^[0-9A-Za-z.+-]{1,40}$/.test(env['NB_CORE_VERSION']) ? env['NB_CORE_VERSION'] : '0.0.0',
    testCrash: hooks && (crash === 'startup' || crash === 'after-ready') ? crash : null,
  };
}
