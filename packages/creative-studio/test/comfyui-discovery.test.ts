import { describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
            UltralyticsDetectorProvider: { input: { required: { model_name: [['bbox/face_yolov8m.pt', 'bbox/hand_yolov8s.pt']] } } },
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
    expect(result.faceDetectors).toEqual(['bbox/face_yolov8m.pt']);
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

  it('keeps nested model subfolders in the inventory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'comfy-models-'));
    try {
      const resourceRoot = join(root, 'resources', 'ComfyUI');
      const checkpoints = join(resourceRoot, 'models', 'checkpoints', 'anime');
      mkdirSync(checkpoints, { recursive: true });
      writeFileSync(join(resourceRoot, 'comfyui_version.py'), '__version__ = "0.20.1"');
      writeFileSync(join(checkpoints, 'model.safetensors'), '');
      const result = await discoverComfyUi({ endpoints: [], installRoots: [root] });
      expect(result.models.checkpoints).toEqual(['anime/model.safetensors']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('merges models from the runtime base directory and extra model paths', async () => {
    const result = await discoverComfyUi({
      endpoints: ['http://127.0.0.1:8000'],
      installRoots: ['C:/ComfyUI'],
      fileSystem: {
        exists: (path) => path.endsWith('comfyui_version.py')
          || path.endsWith('checkpoints')
          || path.endsWith('loras')
          || path.endsWith('extra_models_config.yaml'),
        readFile: (path) => path.endsWith('extra_models_config.yaml')
          ? 'comfyui_desktop:\n  base_path: C:\\Documents\\ComfyUI\n'
          : '__version__ = "0.20.1"',
        listFiles: (path) => path.includes('Documents/ComfyUI') || path.includes('Documents\\ComfyUI')
          ? ['animagine-xl-3.1.safetensors']
          : ['sdxl.safetensors'],
      },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith('/system_stats')) {
          return new Response(JSON.stringify({
            system: {
              argv: [
                'python',
                '--base-directory', 'C:\\Documents\\ComfyUI',
                '--extra-model-paths-config', 'C:\\Documents\\extra_models_config.yaml',
              ],
            },
            devices: [{ name: 'NVIDIA GeForce RTX 4060 Ti', vram_total: 8_188_000_000 }],
          }));
        }
        if (url.endsWith('/object_info')) {
          return new Response(JSON.stringify({
            CheckpointLoaderSimple: { input: { required: { ckpt_name: [['animagine-xl-3.1.safetensors']] } } },
            CLIPTextEncode: {}, EmptyLatentImage: {}, KSampler: {}, VAEDecode: {}, SaveImage: {},
          }));
        }
        return new Response('{}');
      },
    });

    expect(result.state).toBe('ready');
    expect(result.models.checkpoints).toEqual(['animagine-xl-3.1.safetensors', 'sdxl.safetensors']);
  });

  it('reads verified LoRA architecture and trigger words from a safetensors header', async () => {
    const header = new TextEncoder().encode(JSON.stringify({ __metadata__: {
      ss_base_model_version: 'sdxl_base_v1-0',
      ss_trigger_words: 'goku, golden aura',
    } }));
    const bytes = new Uint8Array(8 + header.length);
    new DataView(bytes.buffer).setBigUint64(0, BigInt(header.length), true);
    bytes.set(header, 8);
    const result = await discoverComfyUi({
      endpoints: ['http://127.0.0.1:8188'],
      installRoots: ['C:/ComfyUI'],
      fileSystem: {
        exists: (path) => path.endsWith('comfyui_version.py') || path.endsWith('checkpoints') || path.endsWith('loras'),
        readFile: () => '__version__ = "0.20.1"',
        readBinary: () => bytes,
        listFiles: (path) => path.endsWith('checkpoints') ? ['animagine-xl-3.1.safetensors'] : ['characters/goku.safetensors'],
      },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith('/system_stats')) return new Response(JSON.stringify({ devices: [{ name: 'RTX 4060 Ti', vram_total: 8_188_000_000 }] }));
        if (url.endsWith('/object_info')) return new Response(JSON.stringify({
          CheckpointLoaderSimple: { input: { required: { ckpt_name: [['animagine-xl-3.1.safetensors']] } } },
          CLIPTextEncode: {}, EmptyLatentImage: {}, KSampler: {}, VAEDecode: {}, SaveImage: {},
        }));
        return new Response('{}');
      },
    });

    expect(result.models.loraMetadata).toEqual({
      'characters/goku.safetensors': expect.objectContaining({ architecture: 'sdxl', triggerWords: ['goku', 'golden', 'aura'], metadataVerified: true }),
    });
  });
});
