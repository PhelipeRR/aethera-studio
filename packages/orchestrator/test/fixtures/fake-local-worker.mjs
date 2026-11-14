// Speaks the worker protocol with failures on demand. FAKE_MODE selects the failure; FAKE_STATE counts starts across restarts.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const mode = process.env.FAKE_MODE ?? 'ok';
const state = process.env.FAKE_STATE;
if (state) appendFileSync(state, `${JSON.stringify({ pid: process.pid, keys: Object.keys(process.env) })}\n`);
const starts = state && existsSync(state) ? readFileSync(state, 'utf8').trim().split('\n').length : 1;

const send = (message) => process.stdout.write(`${JSON.stringify({ v: 1, ...message })}\n`);
const detection = { language: 'en', confidence: 0.9, mixed: false, needsModel: false, scores: [] };

createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, op, payload } = JSON.parse(line);
  if (op === 'health') {
    if (mode === 'bad_health') return send({ id, ok: true, result: { status: 'ok', schemaVersion: 99, workerVersion: '0', operations: [] } });
    if (mode === 'crash_at_health') process.exit(3);
    return send({ id, ok: true, result: { status: 'ok', schemaVersion: 1, workerVersion: '0.1.0', operations: ['detect_language'] } });
  }
  if (op === 'cancel') return send({ id, ok: true, result: { cancelled: true } });
  if (mode === 'crash_once' && starts === 1) process.exit(3);
  if (mode === 'always_crash') process.exit(3);
  if (mode === 'hang') return undefined;
  if (mode === 'polite_hang') return setTimeout(() => send({ id, ok: false, error: { code: 'cancelled', message: 'cancelled' } }), 20);
  if (mode === 'wrong_shape') return send({ id, ok: true, result: { language: 42 } });
  if (mode === 'rejected') return send({ id, ok: false, error: { code: 'invalid_payload', message: 'nope' } });
  if (mode === 'garbage') return process.stdout.write('not json\n');
  if (mode === 'uncorrelated') send({ id: 'someone-else', ok: true, result: detection });
  return send({ id, ok: true, result: { ...detection, confidence: payload.text.length > 5 ? 0.9 : 0.1 } });
});
