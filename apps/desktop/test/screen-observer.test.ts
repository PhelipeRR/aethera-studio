import { describe, expect, it, vi } from 'vitest';
import { DesktopScreenObserver } from '../src/main/screen-observer.js';

describe('DesktopScreenObserver', () => {
  it('refuses capture without explicit consent', async () => {
    const capture = vi.fn().mockResolvedValue(Buffer.from('png'));
    const observer = new DesktopScreenObserver({ consent: () => false, capture, outputDir: 'C:/temp/neura-screen', context: async () => null });

    await expect(observer.capture()).rejects.toThrow('consent');
    expect(capture).not.toHaveBeenCalled();
  });

  it('writes a captured PNG as model image metadata', async () => {
    const capture = vi.fn().mockResolvedValue(Buffer.from('png'));
    const write = vi.fn();
    const observer = new DesktopScreenObserver({ consent: () => true, capture, outputDir: 'C:/temp/neura-screen', write, now: () => 123, context: async () => null });

    await expect(observer.capture()).resolves.toMatchObject({ name: 'neura-screen-123.png', mime: 'image/png', size: 3 });
    expect(write).toHaveBeenCalledOnce();
  });

  it('attaches the active window context without persisting another capture', async () => {
    const capture = vi.fn().mockResolvedValue(Buffer.from('png'));
    const write = vi.fn();
    const observer = new DesktopScreenObserver({
      consent: () => true,
      capture,
      outputDir: 'C:/temp/neura-screen',
      write,
      context: async () => ({ application: 'spotify', windowTitle: 'Breakdown Archive', confidence: 'high', windowHandle: '12345', focusedElement: { automationId: 'chat-box', name: 'Message', controlType: 'ControlType.Edit', editable: true, password: false } }),
    });

    await expect(observer.capture()).resolves.toMatchObject({ context: { application: 'spotify', windowTitle: 'Breakdown Archive', confidence: 'high', windowHandle: '12345', focusedElement: { automationId: 'chat-box', controlType: 'ControlType.Edit', editable: true, password: false } } });
  });

  it('masks secrets in the text that travels with the image', async () => {
    const observer = new DesktopScreenObserver({ consent: () => true, capture: async () => Buffer.from('png'), outputDir: 'C:/temp/neura-screen', write: () => undefined, context: async () => ({ application: 'browser', windowTitle: 'password=hunter2hunter2', confidence: 'high', focusedElement: { name: 'token=abcdefghijklmnop', editable: true, password: false } }) });
    const { context } = await observer.capture();
    expect(context?.windowTitle).not.toContain('hunter2');
    expect(context?.focusedElement?.name).not.toContain('abcdefghijklmnop');
  });

  it('refuses a capture too large to send', async () => {
    const observer = new DesktopScreenObserver({ consent: () => true, capture: async () => Buffer.alloc(20_000_001), outputDir: 'C:/temp/neura-screen', write: () => undefined, context: async () => null });
    await expect(observer.capture()).rejects.toThrow('screen_capture_too_large');
  });
});
