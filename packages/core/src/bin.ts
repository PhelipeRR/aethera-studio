import { runCoreProcess } from './process.js';

/** A bare Singularity Core (no domain): /health only. The desktop ships its own host (apps/desktop/src/core-host). */
void runCoreProcess();
