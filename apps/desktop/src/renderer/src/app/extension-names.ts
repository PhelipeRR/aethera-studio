/**
 * AET-02: names shown for extensions whose identity changed on screen but not in data. The extension id `velix` (and
 * its routes, IPC channels, tables and folders) stays; only what the user reads becomes "Aethera". Manifests already
 * saved in the database keep their stored name, so the display goes through this map instead of a data migration.
 */
const DISPLAY_NAMES: Readonly<Record<string, string>> = { velix: 'Aethera' };

export function extensionDisplayName(manifest: { id: string; name: string }): string {
  return DISPLAY_NAMES[manifest.id] ?? manifest.name;
}
