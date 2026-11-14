import { describe, expect, it } from 'vitest';
import { scorePublication, suggestLocalTimes } from '../src/velix-optimizer.js';

describe('Velix publication optimizer', () => {
  it('scores only observable metadata and matches keywords as whole words', () => {
    const score = scorePublication({ title: '5 formas de poupar dinheiro?', description: `${'Uma descrição útil. '.repeat(12)} #dinheiro #finanças 0:30 Comente e inscreva-se`, tags: ['dinheiro', 'poupar'], keyword: 'dinheiro' });
    expect(score).toEqual({ title: 60, description: 52, tags: 82 });
    expect(scorePublication({ title: 'dinheiramento', description: '', tags: [], keyword: 'dinheiro' }).title).toBe(15);
  });
  it('recognizes the documented title and description signals', () => {
    const description = `${'A'.repeat(150)} ${Array.from({ length: 16 }, (_, index) => `#tag${index}`).join(' ')} 01:20 Compartilhe`;
    expect(scorePublication({ title: 'DINHEIRO: 7 SEGREDOS!', description, tags: ['a'], keyword: 'dinheiro' })).toEqual({ title: 75, description: 70, tags: 76 });
  });
  it('returns three transparent local-time slots on different days', () => {
    const slots = suggestLocalTimes('2026-11-03T12:00:00.000Z', 'America/Sao_Paulo');
    expect(slots).toHaveLength(3); expect(new Set(slots).size).toBe(3); expect(slots.every((slot) => slot.endsWith('[America/Sao_Paulo]'))).toBe(true);
    expect(slots[0]).toContain('21:00:00.000Z');
  });
});
