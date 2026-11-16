import { discoverComfyUi } from '../packages/creative-studio/src/comfyui-discovery.js';

const status = await discoverComfyUi({ requestTimeoutMs: 750 });
console.log(JSON.stringify(status, null, 2));
