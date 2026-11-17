import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ComfyUiClient,
  ComfyUiImageAdapter,
  auditGeneratedImage,
  discoverComfyUi,
  extractComfyUiImages,
  type ComfyUiWorkflow,
} from '../packages/creative-studio/src/index.js';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const outputDir = join(root, 'artifacts', 'comfyui-advanced-acceptance');
const defaultReference = join(root, 'artifacts', 'comfyui-bootstrap', 'aethera-facedetailer.png');
const referenceArgIndex = process.argv.indexOf('--reference');
const referencePath = referenceArgIndex >= 0 ? process.argv[referenceArgIndex + 1] : defaultReference;

async function vramMiB(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits']);
    const value = Number.parseInt(stdout.trim().split(/\r?\n/)[0] ?? '', 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

async function runPreprocessor(client: ComfyUiClient, source: string, kind: 'depth' | 'openpose'): Promise<{ image: Buffer; sourceRef: string }> {
  const uploaded = await client.uploadImage(readFileSync(source), 'aethera-advanced-reference.png', 'aethera', true);
  const imageName = uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name;
  const preprocessor = kind === 'depth'
    ? { class_type: 'DepthAnythingV2Preprocessor', inputs: { image: ['1', 0], ckpt_name: 'depth_anything_v2_vitl.pth', resolution: 512 }, title: 'Aethera DepthAnythingV2 condition' }
    : { class_type: 'OpenposePreprocessor', inputs: { image: ['1', 0], detect_hand: 'enable', detect_body: 'enable', detect_face: 'enable', resolution: 512, scale_stick_for_xinsr_cn: 'enable' }, title: 'Aethera OpenPose condition' };
  const workflow: ComfyUiWorkflow = {
    '1': { class_type: 'LoadImage', inputs: { image: imageName }, _meta: { title: 'Aethera advanced reference' } },
    '2': { class_type: preprocessor.class_type, inputs: preprocessor.inputs, _meta: { title: preprocessor.title } },
    '3': { class_type: 'SaveImage', inputs: { filename_prefix: `Aethera/advanced-${kind}`, images: ['2', 0] }, _meta: { title: `Aethera ${kind} condition` } },
  };
  const queued = await client.queuePrompt(workflow);
  const history = await client.waitForCompletion(queued.prompt_id, { timeoutMs: 15 * 60_000 });
  const output = extractComfyUiImages(history)[0];
  if (!output) throw new Error(`${kind} preprocessor completed without an output image.`);
  return { image: await client.getImage(output), sourceRef: imageName };
}

async function runCase(
  adapter: ComfyUiImageAdapter,
  id: string,
  request: Parameters<NonNullable<ComfyUiImageAdapter['generateImage']>>[0],
): Promise<Record<string, unknown>> {
  const started = Date.now();
  const before = await vramMiB();
  let peak = before;
  const sampler = setInterval(() => {
    void vramMiB().then((current) => {
      if (current !== null && (peak === null || current > peak)) peak = current;
    });
  }, 500);
  try {
    const image = await adapter.generateImage(request);
    clearInterval(sampler);
    const after = await vramMiB();
    if (after !== null && (peak === null || after > peak)) peak = after;
    const audit = await auditGeneratedImage(image, { expectedWidth: request.width, expectedHeight: request.height });
    const file = join(outputDir, `${id}.png`);
    writeFileSync(file, image);
    return {
      id,
      status: audit.passed ? 'passed' : 'rejected',
      workflow: request.controlNet ? 'native-txt2img-controlnet' : 'native-txt2img-ipadapter',
      seed: request.seed,
      resolution: `${request.width}x${request.height}`,
      file,
      ms: Date.now() - started,
      vramBeforeMiB: before,
      vramAfterMiB: after,
      vramPeakMiB: peak,
      audit,
    };
  } catch (error) {
    clearInterval(sampler);
    const after = await vramMiB();
    if (after !== null && (peak === null || after > peak)) peak = after;
    return {
      id,
      status: 'failed',
      ms: Date.now() - started,
      vramBeforeMiB: before,
      vramAfterMiB: after,
      vramPeakMiB: peak,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

if (!referencePath || !existsSync(referencePath)) {
  console.log(JSON.stringify({ state: 'blocked', reason: `Reference image not found: ${referencePath ?? '(missing)'}` }, null, 2));
  process.exitCode = 2;
} else {
  const status = await discoverComfyUi({ requestTimeoutMs: 1000 });
  const checkpoint = status.models.checkpoints.find((name) => /animagine/i.test(name)) ?? status.models.checkpoints[0];
  if (status.state !== 'ready' || !status.endpoint || !checkpoint) {
    console.log(JSON.stringify({ state: 'blocked', reason: status.reason ?? 'ComfyUI is not ready with a checkpoint.', status }, null, 2));
    process.exitCode = 2;
  } else {
    mkdirSync(outputDir, { recursive: true });
    const client = new ComfyUiClient({ baseUrl: status.endpoint, requestTimeoutMs: 15_000 });
    const objectInfo = await client.getObjectInfo();
    const depthControlNetModel = status.models.controlnet.find((name) => /depth/i.test(name));
    const openPoseControlNetModel = status.models.controlnet.find((name) => /openpose/i.test(name));
    const ipAdapterModel = status.models.ipadapter[0];
    const clipVisionModel = status.models.clip_vision[0];
    const results: Array<Record<string, unknown>> = [];
    const report: Record<string, unknown> = {
      generatedAt: new Date().toISOString(),
      endpoint: status.endpoint,
      checkpoint,
      reference: referencePath,
      capabilities: status.capabilities,
      models: status.models,
      preprocessors: [],
      results,
      limitations: [
        'A semantic/human review is still required; the structural audit only proves a real PNG with the requested dimensions and non-flat luminance.',
        'The depth map is produced by the installed DepthAnythingV2 preprocessor; this acceptance does not claim pose or identity fidelity.',
      ],
    };
    try {
      if (!status.capabilities.controlNet || !depthControlNetModel) throw new Error('ControlNet Depth capability/model is not available.');
      if (!status.capabilities.ipAdapter || !ipAdapterModel || !clipVisionModel) throw new Error('IP-Adapter capability/model/CLIP Vision encoder is not available.');
      if (!Object.prototype.hasOwnProperty.call(objectInfo, 'DepthAnythingV2Preprocessor')) throw new Error('DepthAnythingV2Preprocessor is not available.');

      const depth = await runPreprocessor(client, referencePath, 'depth');
      const depthFile = join(outputDir, 'depth-condition.png');
      writeFileSync(depthFile, depth.image);
      (report.preprocessors as Array<Record<string, unknown>>).push({ status: 'generated', kind: 'depth', workflow: 'LoadImage → DepthAnythingV2Preprocessor → SaveImage', file: depthFile, sourceRef: depth.sourceRef });

      const adapter = new ComfyUiImageAdapter({
        endpoint: status.endpoint,
        checkpoint,
        timeoutMs: 15 * 60_000,
        releaseMemoryAfterGeneration: true,
        filenamePrefix: 'Aethera/advanced-acceptance',
      });
      results.push(await runCase(adapter, 'controlnet-depth', {
        prompt: 'anime cinematic portrait, one original tech hero, clean face, strong silhouette, cyan and magenta futuristic city light',
        negativePrompt: 'text, letters, watermark, logo, blurry, malformed anatomy, extra limbs, duplicate face',
        width: 512,
        height: 512,
        seed: 21001,
        steps: 8,
        cfg: 5.5,
        samplerName: 'euler',
        scheduler: 'normal',
        controlNet: { model: depthControlNetModel, imagePath: depthFile, strength: 0.55, startPercent: 0, endPercent: 0.85 },
      }));
      if (openPoseControlNetModel && Object.prototype.hasOwnProperty.call(objectInfo, 'OpenposePreprocessor')) {
        try {
          const pose = await runPreprocessor(client, referencePath, 'openpose');
          const poseFile = join(outputDir, 'openpose-condition.png');
          writeFileSync(poseFile, pose.image);
          (report.preprocessors as Array<Record<string, unknown>>).push({ status: 'generated', kind: 'openpose', workflow: 'LoadImage → OpenposePreprocessor → SaveImage', file: poseFile, sourceRef: pose.sourceRef });
          results.push(await runCase(adapter, 'controlnet-openpose', {
            prompt: 'anime cinematic portrait, one original tech hero in the reference pose, clean face and hands, polished key art, cyan and magenta rim light',
            negativePrompt: 'text, letters, watermark, logo, blurry, malformed anatomy, extra limbs, duplicate face',
            width: 512,
            height: 512,
            seed: 21004,
            steps: 8,
            cfg: 5.5,
            samplerName: 'euler',
            scheduler: 'normal',
            controlNet: { model: openPoseControlNetModel, imagePath: poseFile, strength: 0.55, startPercent: 0, endPercent: 0.9 },
          }));
        } catch (error) {
          report.openposeError = error instanceof Error ? error.message : String(error);
        }
      }
      await adapter.releaseMemory();
      results.push(await runCase(adapter, 'ipadapter-plus', {
        prompt: 'anime cinematic portrait, preserve the reference subject identity and hairstyle, clean face, polished key art, cyan and magenta rim light',
        negativePrompt: 'text, letters, watermark, logo, blurry, malformed anatomy, extra limbs, duplicate face',
        width: 512,
        height: 512,
        seed: 21002,
        steps: 8,
        cfg: 5.5,
        samplerName: 'euler',
        scheduler: 'normal',
        ipAdapter: { model: ipAdapterModel, clipVisionModel, referenceImagePath: referencePath, weight: 0.8 },
      }));
      await adapter.releaseMemory();
      results.push(await runCase(adapter, 'ipadapter-plus-low-weight', {
        prompt: 'anime cinematic portrait, preserve the reference subject identity and hairstyle, clean face, polished key art, cyan and magenta rim light',
        negativePrompt: 'text, letters, watermark, logo, blurry, malformed anatomy, extra limbs, duplicate face',
        width: 512,
        height: 512,
        seed: 21003,
        steps: 16,
        cfg: 5.5,
        samplerName: 'euler',
        scheduler: 'normal',
        ipAdapter: { model: ipAdapterModel, clipVisionModel, referenceImagePath: referencePath, weight: 0.35 },
      }));
    } catch (error) {
      report.executionError = error instanceof Error ? error.message : String(error);
    }
    writeFileSync(join(outputDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify(report, null, 2));
    const expectedResults = openPoseControlNetModel ? 4 : 3;
    process.exitCode = results.length === expectedResults && results.every((result) => result.status === 'passed') ? 0 : 1;
  }
}
