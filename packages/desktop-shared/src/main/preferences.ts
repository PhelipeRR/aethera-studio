import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_MONITORING_INTERVAL_MS, DEFAULT_NEURA_SETTINGS, monitoringIntervalSchema, neuraSettingsSchema, themeSourceSchema, type ConfigurationStatus } from '@neuralbridge/shared';
import { z } from 'zod';

// Window-level preferences needed before the database exists (theme drives the title bar colors).
const skillPreferenceSchema = z.object({ skillId: z.string().min(1), taskTypes: z.array(z.string()), agents: z.array(z.enum(['claude', 'codex'])), enabled: z.boolean() });
const historySyncSchema = z.object({ enabled: z.boolean(), paused: z.boolean(), pollIntervalMs: z.number().int().min(5000).max(24 * 60 * 60 * 1000), projectRoots: z.array(z.string()), excludedProjects: z.array(z.string()), excludedSessions: z.array(z.string()) });
const preferencesSchema = z.object({ theme: themeSourceSchema, skillSettings: z.object({ allowlistedHosts: z.array(z.string()), preferences: z.array(skillPreferenceSchema) }).default({ allowlistedHosts: [], preferences: [] }), historySync: historySyncSchema.default({ enabled: false, paused: true, pollIntervalMs: 30000, projectRoots: [], excludedProjects: [], excludedSessions: [] }), tokenBudget: z.number().int().min(10_000).max(50_000_000).default(2_000_000), velixProjectId: z.string().nullable().default(null), velixAgent: z.enum(['claude', 'codex']).default('claude'), companionHud: z.object({ visible: z.boolean().default(true), x: z.number().int().nullable().default(null), y: z.number().int().nullable().default(null), mode: z.enum(['mascot', 'compact', 'expanded']).default('mascot'), alwaysOnTop: z.boolean().default(true), align: z.enum(['left', 'right']).default('left') }).default({ visible: true, x: null, y: null, mode: 'mascot', alwaysOnTop: true, align: 'left' }), spotify: z.object({ enabled: z.boolean().default(false), clientId: z.string().nullable().default(null), controlsEnabled: z.boolean().default(false), last: z.object({ trackId: z.string().nullable(), title: z.string(), artists: z.string(), durationMs: z.number(), device: z.string().nullable(), deviceId: z.string().nullable(), coverUrl: z.string().nullable(), trackUrl: z.string().nullable() }).nullable().default(null) }).default({ enabled: false, clientId: null, controlsEnabled: false, last: null }), neura: neuraSettingsSchema.default(DEFAULT_NEURA_SETTINGS), monitoring: z.object({ intervalMs: monitoringIntervalSchema.default(DEFAULT_MONITORING_INTERVAL_MS) }).default({ intervalMs: DEFAULT_MONITORING_INTERVAL_MS }) });

export type Preferences = z.infer<typeof preferencesSchema>;

export const DEFAULT_PREFERENCES: Preferences = { theme: 'dark', skillSettings: { allowlistedHosts: [], preferences: [] }, historySync: { enabled: false, paused: true, pollIntervalMs: 30000, projectRoots: [], excludedProjects: [], excludedSessions: [] }, tokenBudget: 2_000_000, velixProjectId: null, velixAgent: 'claude', companionHud: { visible: true, x: null, y: null, mode: 'mascot', alwaysOnTop: true, align: 'left' }, spotify: { enabled: false, clientId: null, controlsEnabled: false, last: null }, neura: DEFAULT_NEURA_SETTINGS, monitoring: { intervalMs: DEFAULT_MONITORING_INTERVAL_MS } };

/** Launching the app always brings back the HUD; its position, mode and pin preference remain user-controlled. */
export function showCompanionHudOnLaunch(preferences: Preferences): Preferences {
  return preferences.companionHud.visible ? preferences : { ...preferences, companionHud: { ...preferences.companionHud, visible: true } };
}

export function readPreferences(file: string): Preferences {
  try {
    const parsed = preferencesSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : { ...DEFAULT_PREFERENCES };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

/**
 * Startup check of the preferences file. readPreferences falls back to defaults silently, and the next
 * write would replace the user's file; an invalid file is therefore copied aside first and reported, so
 * the problem is visible and nothing the user wrote is lost.
 */
export function inspectPreferences(file: string, now: () => Date = () => new Date()): ConfigurationStatus {
  if (!existsSync(file)) return { ok: true, file };
  try {
    if (preferencesSchema.safeParse(JSON.parse(readFileSync(file, 'utf8'))).success) return { ok: true, file };
  } catch {
    // Unreadable or not JSON: reported below like a file that fails the schema.
  }
  const preservedAs = `${file}.invalid-${now().toISOString().replace(/[:.]/g, '-')}`;
  try {
    copyFileSync(file, preservedAs);
    return { ok: false, file, reason: 'invalid', preservedAs, recovery: 'review-configuration' };
  } catch {
    return { ok: false, file, reason: 'invalid', preservedAs: null, recovery: 'review-configuration' };
  }
}

export function writePreferences(file: string, preferences: Pick<Preferences, 'theme'> & Partial<Omit<Preferences, 'theme'>>): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify(preferencesSchema.parse({ ...DEFAULT_PREFERENCES, ...preferences }), null, 2));
  renameSync(temp, file);
}
