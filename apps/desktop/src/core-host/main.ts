import { runCoreProcess } from '@neuralbridge/core';
import { composeDesktopDomain } from './domain.js';

/**
 * The app's Singularity Core entry (`out/main/core.js`): the generic Core process with the desktop's task domain.
 * No Electron import here or below (lint rule), so the same file runs embedded today and standalone in CORE-08.
 */
void runCoreProcess({ domain: composeDesktopDomain });
