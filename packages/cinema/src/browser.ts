/**
 * Browser-safe entry point for the renderer process.
 * Only modules without Node built-ins (fs, child_process, node:crypto, …) may be re-exported here;
 * the main barrel (`index.ts`) pulls in the FFmpeg renderer and must never reach the browser bundle.
 */
export * from './production-contract.js';
export * from './director/aethera-format-catalog.js';
