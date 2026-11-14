import { z } from 'zod';

/*
 * Performance monitoring contract (Fase 50, lote 50.08). Every metric is a real reading from Windows or null when the
 * sensor is not available on this machine; the reason travels with the static info. Nothing here is estimated.
 */

export const MONITORING_INTERVALS_MS = [1000, 2000, 5000, 10000] as const;
export const DEFAULT_MONITORING_INTERVAL_MS = 2000;
/** Samples kept in memory: 10 minutes at the default interval. */
export const MONITORING_HISTORY = 300;

const nullableNumber = z.number().finite().nullable();
const bytes = z.number().finite().nonnegative().nullable();

export const monitorSampleSchema = z.strictObject({
  seq: z.number().int().nonnegative(),
  /** ms since epoch. */
  at: z.number().int(),
  cpu: z.strictObject({ utilization: nullableNumber, frequencyMhz: nullableNumber, temperatureC: nullableNumber }),
  memory: z.strictObject({ usedBytes: bytes, availableBytes: bytes, totalBytes: bytes }),
  gpu: z.strictObject({ utilization: nullableNumber, temperatureC: nullableNumber, vramUsedBytes: bytes, vramTotalBytes: bytes }),
  disk: z.strictObject({ busy: nullableNumber, readBytesPerSec: bytes, writeBytesPerSec: bytes }),
  network: z.strictObject({ downBytesPerSec: bytes, upBytesPerSec: bytes, linkBitsPerSec: bytes }),
  /** All Electron processes of the app (main, renderers, GPU, utilities), from Electron's own metrics. */
  app: z.strictObject({ cpuPercent: nullableNumber, memoryBytes: bytes }),
  /** The collector's own child processes (typeperf, nvidia-smi): the cost of monitoring. */
  overhead: z.strictObject({ cpuPercent: nullableNumber, memoryBytes: bytes }),
});
export type MonitorSample = z.infer<typeof monitorSampleSchema>;

export const MONITOR_SOURCES = ['cpu', 'cpuTemperature', 'memory', 'gpu', 'gpuTemperature', 'vram', 'disk', 'network', 'app', 'overhead'] as const;
export type MonitorSource = (typeof MONITOR_SOURCES)[number];

export const sourceStatusSchema = z.strictObject({
  available: z.boolean(),
  /** Where the value comes from, e.g. "Contadores de desempenho do Windows" or "nvidia-smi". */
  provider: z.string().nullable(),
  /** Why it is unavailable, in Portuguese, for the UI. */
  reason: z.string().nullable(),
});
export type SourceStatus = z.infer<typeof sourceStatusSchema>;

export const driveSchema = z.strictObject({ mount: z.string(), totalBytes: z.number().nonnegative(), freeBytes: z.number().nonnegative() });

export const monitorStaticSchema = z.strictObject({
  cpuModel: z.string().nullable(),
  logicalCores: z.number().int().nonnegative(),
  gpuName: z.string().nullable(),
  drives: z.array(driveSchema),
  sources: z.record(z.enum(MONITOR_SOURCES), sourceStatusSchema),
});
export type MonitorStatic = z.infer<typeof monitorStaticSchema>;

/**
 * Future per-consumer usage (Claude, Codex, Singularity Core, MCP tools, RAG). Declared now so the UI and contract
 * are ready; a consumer is "monitored" only when a real process group feeds it.
 */
export const CONSUMER_IDS = ['singularity', 'claude', 'codex', 'core', 'mcp', 'rag'] as const;
export const consumerSchema = z.strictObject({
  id: z.enum(CONSUMER_IDS),
  label: z.string(),
  monitored: z.boolean(),
  cpuPercent: nullableNumber,
  memoryBytes: bytes,
  processes: z.number().int().nonnegative(),
  reason: z.string().nullable(),
});
export type MonitorConsumer = z.infer<typeof consumerSchema>;

export const monitorSnapshotSchema = z.strictObject({
  state: z.enum(['starting', 'running', 'unavailable']),
  intervalMs: z.number().int(),
  static: monitorStaticSchema,
  /** Samples newer than the requested `since` (all kept samples when omitted), oldest first. */
  samples: z.array(monitorSampleSchema),
  consumers: z.array(consumerSchema),
});
export type MonitorSnapshot = z.infer<typeof monitorSnapshotSchema>;

export const monitoringIntervalSchema = z.union(MONITORING_INTERVALS_MS.map((value) => z.literal(value)) as unknown as [z.ZodLiteral<1000>, z.ZodLiteral<2000>, z.ZodLiteral<5000>, z.ZodLiteral<10000>]);
export type MonitoringInterval = (typeof MONITORING_INTERVALS_MS)[number];
