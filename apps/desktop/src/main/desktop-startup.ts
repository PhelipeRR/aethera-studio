export const AUTOSTART_ARG = '--neuralbridge-autostart';

export function isAutostartLaunch(argv: readonly string[]): boolean {
  return argv.includes(AUTOSTART_ARG);
}

export function loginItemSettings(platform: NodeJS.Platform, packaged: boolean): { openAtLogin: true; args: [string] } | null {
  return platform === 'win32' && packaged ? { openAtLogin: true, args: [AUTOSTART_ARG] } : null;
}
