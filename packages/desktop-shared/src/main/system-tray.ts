import { Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron';

export interface SystemTrayActions {
  mainVisible(): boolean;
  showMain(): void;
  hideMain(): void;
  showHud(): void;
  openVoiceStudio(): void;
  quit(): void;
}

export function buildTrayMenuTemplate(actions: SystemTrayActions): MenuItemConstructorOptions[] {
  return [
    { label: actions.mainVisible() ? 'Ocultar Singularity' : 'Abrir Singularity', click: () => { if (actions.mainVisible()) actions.hideMain(); else actions.showMain(); } },
    { type: 'separator' },
    { label: 'Mostrar HUD', click: () => actions.showHud() },
    { label: 'Abrir VoiceStudio', click: () => actions.openVoiceStudio() },
    { type: 'separator' },
    { label: 'Sair', click: () => actions.quit() },
  ];
}

export function createSystemTray(iconPath: string, actions: SystemTrayActions): Tray {
  const tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('Singularity');
  const refresh = (): void => tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate(actions)));
  refresh();
  tray.on('click', () => { if (actions.mainVisible()) actions.hideMain(); else actions.showMain(); refresh(); });
  tray.on('double-click', () => { actions.showMain(); refresh(); });
  return tray;
}
