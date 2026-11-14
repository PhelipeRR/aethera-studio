import { eq } from 'drizzle-orm';
import { settings, type DatabaseHandle } from '@neuralbridge/database';
import { brainSettingsSchema, DEFAULT_BRAIN_SETTINGS, type BrainSettings } from '@neuralbridge/shared';

const KEY = 'brain';

/** Brain Settings (learning mode, backups, retention). A value that no longer parses falls back to the defaults. */
export function readBrainSettings(handle: DatabaseHandle): BrainSettings {
  const row = handle.db.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY)).get();
  if (!row) return structuredClone(DEFAULT_BRAIN_SETTINGS);
  try {
    const parsed = brainSettingsSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : structuredClone(DEFAULT_BRAIN_SETTINGS);
  } catch {
    return structuredClone(DEFAULT_BRAIN_SETTINGS);
  }
}

export function writeBrainSettings(handle: DatabaseHandle, value: BrainSettings): BrainSettings {
  const parsed = brainSettingsSchema.parse(value);
  const json = JSON.stringify(parsed);
  const updatedAt = new Date().toISOString();
  handle.db.insert(settings).values({ key: KEY, value: json, updatedAt }).onConflictDoUpdate({ target: settings.key, set: { value: json, updatedAt } }).run();
  return parsed;
}
