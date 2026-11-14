import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsonNeuraHistory } from '../src/main/neura-history.js';

describe('JsonNeuraHistory', () => {
  it('persists only the bounded general conversation and can erase it', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'neura-history-')), 'conversation.json');
    const history = new JsonNeuraHistory(file);
    const turns = Array.from({ length: 8 }, (_, index) => ({ request: `pergunta-${index}`, reply: `resposta-${index}` }));

    history.save(turns);
    expect(history.load()).toHaveLength(6);
    expect(history.load()[0]?.request).toBe('pergunta-2');
    expect(JSON.stringify(readFileSync(file, 'utf8'))).not.toContain('pergunta-0');
    history.clear();
    expect(existsSync(file)).toBe(false);
  });
});
