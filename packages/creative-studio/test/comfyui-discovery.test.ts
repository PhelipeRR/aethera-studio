import { describe, expect, it } from 'vitest';
import { discoverComfyUi, parseComfyUiVersion, type ComfyUiFileSystem } from '../src/comfyui-discovery.js';

function fakeFileSystem(): ComfyUiFileSystem {
  return {
    exists: (path) => path.endsWith('comfyui_version.py') || path.endsWith('checkpoints') || path.endsWith('loras'),
    readFile: () => '__version__ = "0.20.1"',
    listFiles: (path) => (path.endsWith('checkpoints') ? ['sdxl.safetensors'] : ['style.safetensors']),
  };
}

describe('ComfyUI discovery', () => {
  it('extracts the installed ComfyUI version from the version module', () => {
    expect(parseComfyUiVersion('__version__ = "0.20.1"')).toBe('0.20.1');
    expect(parseComfyUiVersion('no version here')).toBeUndefined();
  });

  it('reports a reachable server, its CUDA device, and installed model inventory', async () => {
    const result = await discoverComfyUi({
      endpoints: ['http://127.0.0.1:8188'],
      installRoots: ['C:/ComfyUI'],
      fileSystem: fakeFileSystem(),
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith('/system_stats')) {
          return new Response(JSON.stringify({ system: { os: 'win32' }, devices: [{ name: 'NVIDIA GeForce RTX 4060 Ti', vram_total: 8_188_000_000 }] }));
        }
        if (url.endsWith('/object_info')) {
          return new Response(JSON.stringify({
            CheckpointLoaderSimple: { input: { required: { ckpt_name: [['sdxl.safetensors']] } } },
            CLIPTextEncode: {}, EmptyLatentImage: {}, KSampler: {}, VAEDecode: {}, SaveImage: {},
          }));
        }
        return new Response('{}');
      },
    });

    expect(result.state).toBe('ready');
    expect(result.endpoint).toBe('http://127.0.0.1:8188');
    expect(result.version).toBe('0.20.1');
    expect(result.device?.name).toContain('4060 Ti');
    expect(result.models.checkpoints).toEqual(['sdxl.safetensors']);
    expect(result.models.loras).toEqual(['style.safetensors']);
    expect(result.reason).toBeUndefined();
  });

  it('distinguishes an installed-but-stopped runtime from a missing installation', async () => {
    const offline = await discoverComfyUi({
      endpoints: ['http://localhost:8188'],
      installRoots: ['C:/ComfyUI'],
      fileSystem: fakeFileSystem(),
      fetchImpl: async () => { throw new Error('connection refused'); },
    });
    expect(offline.state).toBe('offline');
    expect(offline.version).toBe('0.20.1');
    expect(offline.reason).toMatch(/not reachable/i);

    const missing = await discoverComfyUi({
      endpoints: ['http://localhost:8188'],
      installRoots: [],
      fetchImpl: async () => { throw new Error('connection refused'); },
    });
    expect(missing.state).toBe('not_installed');
  });
});
