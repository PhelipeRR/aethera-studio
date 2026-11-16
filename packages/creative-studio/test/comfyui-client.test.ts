import { describe, expect, it } from 'vitest';
import { ComfyUiClient, normalizeComfyUiBaseUrl } from '../src/comfyui-client.js';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ComfyUiClient', () => {
  it('accepts only loopback HTTP endpoints and normalizes the root path', () => {
    expect(normalizeComfyUiBaseUrl('http://127.0.0.1:8188/')).toBe('http://127.0.0.1:8188');
    expect(normalizeComfyUiBaseUrl('http://localhost:8000')).toBe('http://localhost:8000');
    expect(normalizeComfyUiBaseUrl('http://[::1]:8188/')).toBe('http://[::1]:8188');
    expect(() => normalizeComfyUiBaseUrl('https://127.0.0.1:8188')).toThrow(/HTTP loopback/);
    expect(() => normalizeComfyUiBaseUrl('http://192.168.1.10:8188')).toThrow(/HTTP loopback/);
    expect(() => normalizeComfyUiBaseUrl('http://127.0.0.1:8188/comfy')).toThrow(/root path/);
  });

  it('reads system stats and object info, queues a prompt, and fetches an image', async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const client = new ComfyUiClient({
      baseUrl: 'http://127.0.0.1:8188',
      fetchImpl: async (input, init) => {
        const url = String(input);
        calls.push({ url, method: init?.method ?? 'GET', ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
        if (url.endsWith('/system_stats')) {
          return jsonResponse({ system: { os: 'win32', python_version: '3.12' }, devices: [{ name: 'cuda:0', vram_total: 8_000_000_000 }] });
        }
        if (url.endsWith('/object_info')) return jsonResponse({ CheckpointLoaderSimple: {}, KSampler: {} });
        if (url.endsWith('/prompt')) return jsonResponse({ prompt_id: 'prompt-123' });
        if (url.includes('/view?')) return new Response(Uint8Array.from([137, 80, 78, 71]), { status: 200 });
        return jsonResponse({});
      },
      clientId: 'test-client',
    });

    await expect(client.getSystemStats()).resolves.toMatchObject({ system: { os: 'win32' } });
    await expect(client.getObjectInfo()).resolves.toMatchObject({ CheckpointLoaderSimple: {} });
    await expect(client.queuePrompt({ '1': { class_type: 'CheckpointLoaderSimple', inputs: {} } })).resolves.toEqual({
      prompt_id: 'prompt-123',
    });
    await expect(client.getImage({ filename: 'output.png', subfolder: 'batch 1', type: 'output' })).resolves.toEqual(
      Buffer.from([137, 80, 78, 71]),
    );

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET http://127.0.0.1:8188/system_stats',
      'GET http://127.0.0.1:8188/object_info',
      'POST http://127.0.0.1:8188/prompt',
      'GET http://127.0.0.1:8188/view?filename=output.png&subfolder=batch+1&type=output',
    ]);
    expect(JSON.parse(calls[2]?.body ?? '{}')).toMatchObject({ client_id: 'test-client' });
  });

  it('polls history until the prompt is complete and reports execution errors', async () => {
    let historyCalls = 0;
    const client = new ComfyUiClient({
      baseUrl: 'http://localhost:8188',
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith('/history/prompt-456')) {
          historyCalls += 1;
          return historyCalls === 1 ? jsonResponse({}) : jsonResponse({ 'prompt-456': { status: { completed: true }, outputs: {} } });
        }
        return jsonResponse({});
      },
      sleep: async () => undefined,
    });

    await expect(client.waitForCompletion('prompt-456', { pollMs: 1, timeoutMs: 100 })).resolves.toMatchObject({
      status: { completed: true },
    });
    expect(historyCalls).toBe(2);

    const errorClient = new ComfyUiClient({
      baseUrl: 'http://localhost:8188',
      fetchImpl: async () => jsonResponse({ 'prompt-err': { status: { status_str: 'error', completed: false, messages: [['execution_error', { exception_message: 'bad graph' }]] } } }),
    });
    await expect(errorClient.waitForCompletion('prompt-err', { pollMs: 1, timeoutMs: 100 })).rejects.toThrow(/bad graph/);
  });
});
