import { describe, expect, it, vi } from 'vitest';
import { AllowedApplicationExecutor } from '../src/computer-executors.js';

const request = (actionType: string) => ({ actionId: '00000000-0000-4000-8000-000000000301', sessionId: null, actionType, risk: 'confirm' as const, summary: 'open', fingerprint: 'open-1', createdAt: '2026-11-02T12:00:00.000Z', expiresAt: '2026-11-02T12:05:00.000Z' });

describe('AllowedApplicationExecutor', () => {
  it('launches only explicitly allowed applications', async () => {
    const launch = vi.fn().mockResolvedValue(undefined);
    const executor = new AllowedApplicationExecutor({ launch });
    await expect(executor.execute(request('computer.open_app:teams'))).resolves.toContain('teams');
    expect(launch).toHaveBeenCalledWith('teams');
  });

  it('rejects arbitrary commands and transcript text', async () => {
    const launch = vi.fn().mockResolvedValue(undefined);
    const executor = new AllowedApplicationExecutor({ launch });
    await expect(executor.execute(request('cmd.exe /c whoami'))).rejects.toThrow('blocked');
    expect(launch).not.toHaveBeenCalled();
  });

  it('types only an explicitly confirmed reply payload', async () => {
    const typeText = vi.fn().mockResolvedValue(undefined);
    const executor = new AllowedApplicationExecutor({ launch: vi.fn(), typeText });
    await expect(executor.execute({ ...request('computer.type_chat_reply'), payload: { text: 'Obrigado pela mensagem.' } })).resolves.toContain('digitada');
    expect(typeText).toHaveBeenCalledWith('Obrigado pela mensagem.');
  });

  it('passes the consented target window without accepting arbitrary commands', async () => {
    const typeText = vi.fn().mockResolvedValue(undefined);
    const executor = new AllowedApplicationExecutor({ launch: vi.fn(), typeText });
    await executor.execute({ ...request('computer.type_chat_reply'), payload: { text: 'Na janela certa.', targetWindow: '12345' } });
    expect(typeText).toHaveBeenCalledWith('Na janela certa.', { targetWindow: '12345' });
  });

  it('passes the focused editable element to the native input seam', async () => {
    const typeText = vi.fn().mockResolvedValue(undefined);
    const executor = new AllowedApplicationExecutor({ launch: vi.fn(), typeText });
    await executor.execute({ ...request('computer.type_chat_reply'), payload: { text: 'No campo certo.', targetWindow: '12345', targetElement: { automationId: 'chat-box', controlType: 'ControlType.Edit' } } });
    expect(typeText).toHaveBeenCalledWith('No campo certo.', { targetWindow: '12345', targetElement: { automationId: 'chat-box', controlType: 'ControlType.Edit' } });
  });

  it('starts a project task only with a bound project and a configured starter', async () => {
    const start = vi.fn().mockResolvedValue('task');
    const executor = new AllowedApplicationExecutor({ launch: vi.fn() }, { start });
    await expect(executor.execute({ ...request('project.edit_task'), payload: { text: 'corrija src/app.ts' } })).rejects.toThrow('blocked');
    await expect(new AllowedApplicationExecutor({ launch: vi.fn() }).execute({ ...request('project.edit_task'), payload: { text: 'x', projectId: 'p1' } })).rejects.toThrow('blocked');
    await executor.execute({ ...request('project.edit_task'), payload: { text: 'corrija src/app.ts', projectId: 'p1' } });
    expect(start).toHaveBeenCalledWith({ prompt: expect.stringContaining('corrija src/app.ts'), projectId: 'p1', externalRef: { system: 'void', id: `action/${request('project.edit_task').actionId}`, revision: 1 } });
  });

  it('rejects a reply without the native input seam', async () => {
    const executor = new AllowedApplicationExecutor({ launch: vi.fn() });
    await expect(executor.execute({ ...request('computer.type_chat_reply'), payload: { text: 'não deve sair' } })).rejects.toThrow('blocked');
  });
});
