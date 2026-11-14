import { z } from 'zod';
import { grantSchema, pairingOfferSchema } from './core-api/auth.js';

/*
 * CORE-07: what the desktop's "Dispositivos e acesso remoto" screen exchanges with the main process over IPC. The main
 * forwards each request to the Core's desktop-only routes; no token or key ever reaches the renderer.
 */

export const coreRemoteStatusSchema = z.strictObject({
  supervisor: z.enum(['disabled', 'idle', 'starting', 'running', 'attached', 'restarting', 'failed', 'stopping', 'stopped']),
  enabled: z.boolean(),
  state: z.enum(['not-installed', 'logged-out', 'stopped', 'ready', 'blocked', 'unavailable']),
  hostname: z.string().max(253).nullable(),
  serving: z.boolean(),
  detail: z.string().max(300).nullable(),
});
export type CoreRemoteStatus = z.infer<typeof coreRemoteStatusSchema>;

export const corePendingPairingSchema = z.strictObject({ pairingId: z.string().max(64), deviceName: z.string().max(60), platform: z.string().max(20), appVersion: z.string().max(20), expiresAt: z.string() });
export type CorePendingPairing = z.infer<typeof corePendingPairingSchema>;

export const coreDeviceSchema = z.strictObject({ id: z.string().max(64), name: z.string().max(60), platform: z.string().max(20), appVersion: z.string().max(20), grant: grantSchema, pairedAt: z.string(), lastSeenAt: z.string().nullable(), revokedAt: z.string().nullable() });
export type CoreDevice = z.infer<typeof coreDeviceSchema>;

/** CORE-08: how the Core runs now (embedded with the window, or standalone at logon) and what it costs. */
export const coreRuntimeSchema = z.strictObject({
  mode: z.enum(['embedded', 'standalone']).nullable(),
  pid: z.number().int().positive().nullable(),
  version: z.string().max(40).nullable(),
  uptimeMs: z.number().int().nonnegative().nullable(),
  memoryBytes: z.number().int().nonnegative().nullable(),
  cpuPercent: z.number().nonnegative().nullable(),
  tasksRunning: z.number().int().nonnegative().nullable(),
  standaloneEnabled: z.boolean(),
  taskRegistered: z.boolean(),
});
export type CoreRuntime = z.infer<typeof coreRuntimeSchema>;

export const corePairingOfferSchema = pairingOfferSchema;
export type CorePairingOffer = z.infer<typeof corePairingOfferSchema>;
