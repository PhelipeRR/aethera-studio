import { describe, expect, it, vi } from 'vitest';
import { buildTrayMenuTemplate } from '../src/main/system-tray.js';

describe('NeuralBridge system tray', () => {
  it('offers restore, HUD and exit actions', () => {
    const actions = { mainVisible: () => false, showMain: vi.fn(), hideMain: vi.fn(), showHud: vi.fn(), openVoiceStudio: vi.fn(), quit: vi.fn() };
    const menu = buildTrayMenuTemplate(actions);

    expect(menu.flatMap((item) => item.label ? [item.label] : [])).toEqual(['Abrir Singularity', 'Mostrar HUD', 'Abrir VoiceStudio', 'Sair']);
    const click = (label: string): void => menu.find((item) => item.label === label)?.click?.({} as never, {} as never, {} as never);
    click('Abrir Singularity');
    click('Mostrar HUD');
    click('Abrir VoiceStudio');
    click('Sair');
    expect(actions.showMain).toHaveBeenCalledOnce();
    expect(actions.showHud).toHaveBeenCalledOnce();
    expect(actions.openVoiceStudio).toHaveBeenCalledOnce();
    expect(actions.quit).toHaveBeenCalledOnce();
  });

  it('offers hide instead of restore while the main window is visible', () => {
    const actions = { mainVisible: () => true, showMain: vi.fn(), hideMain: vi.fn(), showHud: vi.fn(), openVoiceStudio: vi.fn(), quit: vi.fn() };
    const menu = buildTrayMenuTemplate(actions);
    expect(menu[0]?.label).toBe('Ocultar Singularity');
    menu[0]?.click?.({} as never, {} as never, {} as never);
    expect(actions.hideMain).toHaveBeenCalledOnce();
  });
});
