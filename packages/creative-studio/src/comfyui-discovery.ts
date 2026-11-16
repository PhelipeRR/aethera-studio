import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComfyUiClient, normalizeComfyUiBaseUrl, type ComfyUiSystemStats } from './comfyui-client.js';

export type ComfyUiRuntimeState = 'ready' | 'misconfigured' | 'offline' | 'not_installed';

export interface ComfyUiFileSystem {
  exists: (path: string) => boolean;
  readFile: (path: string) => string;
  listFiles: (path: string) => string[];
}

export interface ComfyUiModelInventory {
  checkpoints: string[];
  controlnet: string[];
  diffusion_models: string[];
  loras: string[];
  vae: string[];
  upscale_models: string[];
  embeddings: string[];
}

export interface ComfyUiStatus {
  state: ComfyUiRuntimeState;
  endpoint?: string;
  installRoot?: string;
  version?: string;
  device?: {
    name?: string;
    type?: string;
    vramTotalBytes?: number;
    vramFreeBytes?: number;
  };
  models: ComfyUiModelInventory;
  reason?: string;
}

export interface ComfyUiDiscoveryOptions {
  endpoints?: string[];
  installRoots?: string[];
  fetchImpl?: typeof fetch;
  fileSystem?: ComfyUiFileSystem;
  requestTimeoutMs?: number;
}

const MODEL_CATEGORIES: Array<keyof ComfyUiModelInventory> = [
  'checkpoints',
  'controlnet',
  'diffusion_models',
  'loras',
  'vae',
  'upscale_models',
  'embeddings',
];

const MODEL_EXTENSIONS = /\.(?:safetensors|ckpt|pt|pth|bin|gguf|onnx)$/i;

const nativeFileSystem: ComfyUiFileSystem = {
  exists: existsSync,
  readFile: (path) => readFileSync(path, 'utf8'),
  listFiles: (path) => {
    const result: string[] = [];
    const visit = (directory: string, relativePrefix: string): void => {
      let entries;
      try {
        entries = readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const child = join(directory, entry.name);
        if (entry.isDirectory()) visit(child, join(relativePrefix, entry.name));
        else if (MODEL_EXTENSIONS.test(entry.name)) result.push(join(relativePrefix, entry.name).replaceAll('\\', '/'));
      }
    };
    visit(path, '');
    return result.sort((a, b) => a.localeCompare(b));
  },
};

export function parseComfyUiVersion(source: string): string | undefined {
  const match = source.match(/__version__\s*=\s*["']([^"']+)["']/);
  return match?.[1];
}

function defaultInstallRoots(): string[] {
  const roots: string[] = [];
  const configured = process.env['COMFYUI_PATH'];
  if (configured) roots.push(configured);
  const localAppData = process.env['LOCALAPPDATA'];
  if (localAppData) roots.push(join(localAppData, 'Programs', 'ComfyUI'));
  return roots;
}

function findInstallRoot(roots: string[], fileSystem: ComfyUiFileSystem): { root: string; resourceRoot: string; version?: string } | undefined {
  for (const root of roots) {
    const resourceRoot = join(root, 'resources', 'ComfyUI');
    const versionPaths = [join(resourceRoot, 'comfyui_version.py'), join(root, 'comfyui_version.py')];
    const versionPath = versionPaths.find((path) => fileSystem.exists(path));
    const knownInstall = Boolean(versionPath) || fileSystem.exists(resourceRoot) || fileSystem.exists(join(root, 'models'));
    if (!knownInstall) continue;
    let version: string | undefined;
    if (versionPath) {
      try {
        version = parseComfyUiVersion(fileSystem.readFile(versionPath));
      } catch {
        // The install can still be diagnosed from its directory when the version file is unreadable.
      }
    }
    return { root, resourceRoot: fileSystem.exists(resourceRoot) ? resourceRoot : root, ...(version ? { version } : {}) };
  }
  return undefined;
}

function emptyInventory(): ComfyUiModelInventory {
  return {
    checkpoints: [],
    controlnet: [],
    diffusion_models: [],
    loras: [],
    vae: [],
    upscale_models: [],
    embeddings: [],
  };
}

function inventoryFor(resourceRoot: string, fileSystem: ComfyUiFileSystem): ComfyUiModelInventory {
  const inventory = emptyInventory();
  for (const category of MODEL_CATEGORIES) {
    const directory = join(resourceRoot, 'models', category);
    if (!fileSystem.exists(directory)) continue;
    inventory[category] = fileSystem.listFiles(directory).filter((path) => MODEL_EXTENSIONS.test(path));
  }
  return inventory;
}

function checkpointNamesFromObjectInfo(objectInfo: Record<string, unknown>): string[] {
  const loader = objectInfo['CheckpointLoaderSimple'];
  if (!loader || typeof loader !== 'object') return [];
  const input = (loader as Record<string, unknown>)['input'];
  const required = input && typeof input === 'object' ? (input as Record<string, unknown>)['required'] : undefined;
  const values = required && typeof required === 'object' ? (required as Record<string, unknown>)['ckpt_name'] : undefined;
  if (!Array.isArray(values) || !Array.isArray(values[0])) return [];
  return values[0].filter((value): value is string => typeof value === 'string');
}

function deviceFrom(stats: ComfyUiSystemStats): ComfyUiStatus['device'] {
  const device = stats.devices?.[0];
  if (!device) return undefined;
  return {
    ...(device.name ? { name: device.name } : {}),
    ...(device.type ? { type: device.type } : {}),
    ...(typeof device.vram_total === 'number' ? { vramTotalBytes: device.vram_total } : {}),
    ...(typeof device.vram_free === 'number' ? { vramFreeBytes: device.vram_free } : {}),
  };
}

export async function discoverComfyUi(options?: ComfyUiDiscoveryOptions): Promise<ComfyUiStatus> {
  const fileSystem = options?.fileSystem ?? nativeFileSystem;
  const install = findInstallRoot(options?.installRoots ?? defaultInstallRoots(), fileSystem);
  const endpoints = options?.endpoints ?? ['http://127.0.0.1:8188', 'http://127.0.0.1:8000'];
  const models = install ? inventoryFor(install.resourceRoot, fileSystem) : emptyInventory();
  const errors: string[] = [];

  for (const endpoint of endpoints) {
    let client: ComfyUiClient;
    try {
      const clientOptions = {
        baseUrl: endpoint,
        ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options?.requestTimeoutMs !== undefined ? { requestTimeoutMs: options.requestTimeoutMs } : {}),
      };
      client = new ComfyUiClient(clientOptions);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    try {
      const stats = await client.getSystemStats();
      const objectInfo = await client.getObjectInfo();
      const discoveredCheckpoints = checkpointNamesFromObjectInfo(objectInfo);
      const mergedModels = {
        ...models,
        checkpoints: models.checkpoints.length > 0 ? models.checkpoints : discoveredCheckpoints,
      };
      const requiredNodes = ['CheckpointLoaderSimple', 'CLIPTextEncode', 'EmptyLatentImage', 'KSampler', 'VAEDecode', 'SaveImage'];
      const missingNodes = requiredNodes.filter((node) => !(node in objectInfo));
      const reason = missingNodes.length > 0
        ? `ComfyUI is missing native nodes: ${missingNodes.join(', ')}.`
        : mergedModels.checkpoints.length === 0
          ? 'ComfyUI is reachable but no checkpoint model is installed.'
          : undefined;
      const device = deviceFrom(stats);
      return {
        state: reason ? 'misconfigured' : 'ready',
        endpoint: client.baseUrl,
        ...(install?.root ? { installRoot: install.root } : {}),
        ...(install?.version ? { version: install.version } : {}),
        ...(device ? { device } : {}),
        models: mergedModels,
        ...(reason ? { reason } : {}),
      };
    } catch (error) {
      errors.push(`${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!install) {
    return { state: 'not_installed', models, reason: 'ComfyUI installation was not found and no endpoint is reachable.' };
  }
  return {
    state: 'offline',
    ...(install.root ? { installRoot: install.root } : {}),
    ...(install.version ? { version: install.version } : {}),
    models,
    reason: `ComfyUI is installed but not reachable. ${errors.join(' ')}`.trim(),
  };
}
