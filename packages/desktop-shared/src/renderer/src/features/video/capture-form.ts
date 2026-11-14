export type CaptureScreen = { name: string; path: string };

export function screensToText(screens: readonly CaptureScreen[]): string {
  return screens.map((screen) => `${screen.name} | ${screen.path}`).join('\n');
}

export function screensFromText(text: string): CaptureScreen[] {
  return text.split('\n').flatMap((line) => {
    const [name = '', ...path] = line.split('|');
    return name.trim() ? [{ name: name.trim(), path: path.join('|').trim() }] : [];
  });
}

export function envToText(env: Record<string, string>): string {
  return Object.entries(env).map(([name, value]) => `${name}=${value}`).join('\n');
}

export function envFromText(text: string): Record<string, string> {
  return Object.fromEntries(text.split('\n').flatMap((line) => {
    const index = line.indexOf('=');
    return index > 0 ? [[line.slice(0, index).trim(), line.slice(index + 1).trim()]] : [];
  }));
}
