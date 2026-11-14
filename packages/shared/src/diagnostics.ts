import { redactEvidence } from './evidence.js';

export interface DiagnosticMetadata {
  appVersion: string;
  commit: string | null;
  platform: string;
  architecture: string;
  migrationState: { applied: number; latest: string | null; failed: string | null };
  extensions: Array<{ id: string; version: string; state: string }>;
}

const SECRET_KEY = /(token|secret|password|authorization|cookie|credential|api[-_]?key|private[-_]?key|checkpoint)/i;
const SECRET_VALUE = /(bearer\s+|api[_-]?key\s*[=:]\s*|password\s*[=:]\s*|token\s*[=:]\s*)[^\s,;]+/gi;

export function redactDiagnosticValue(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '[redacted]';
  if (typeof value === 'string') return redactEvidence(value.replace(SECRET_VALUE, '$1[redacted]'));
  if (Array.isArray(value)) return value.map((item) => redactDiagnosticValue(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactDiagnosticValue(childValue, childKey)]));
  return value;
}

export function createDiagnosticReport(metadata: DiagnosticMetadata, details: Record<string, unknown> = {}) {
  return redactDiagnosticValue({ schemaVersion: 1, generatedAt: new Date().toISOString(), metadata, details }) as Record<string, unknown>;
}

export function serializeDiagnosticReport(metadata: DiagnosticMetadata, details: Record<string, unknown> = {}) {
  return `${JSON.stringify(createDiagnosticReport(metadata, details), null, 2)}\n`;
}
