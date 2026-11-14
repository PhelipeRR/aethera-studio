/**
 * Singularity Core public API v1 (CORE-02). Imported as `@neuralbridge/shared/core-api`, separate from the internal
 * IPC contracts on purpose: this surface is versioned for remote clients (Companion Mobile, orchestrators, external
 * agents) and only changes additively inside v1. Architecture: docs/architecture/core-02-api-contracts.md.
 */
export * from './common.js';
export * from './errors.js';
export * from './version.js';
export * from './limits.js';
export * from './auth.js';
export * from './tasks.js';
export * from './events.js';
export * from './memory.js';
export * from './integrations.js';
export * from './routes.js';
