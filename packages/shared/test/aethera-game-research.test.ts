import { describe, expect, it } from 'vitest';
import { gameSourceObservationSchema, normalizeGameTitle, resolveGameVerification, type GameSourceObservation } from '../src/index.js';

// Synthetic observations written for these tests; they are not real API responses.
const observation = (source: GameSourceObservation['source'], releaseDate: string | null, overrides: Partial<GameSourceObservation> = {}): GameSourceObservation => gameSourceObservationSchema.parse({
  schemaVersion: 1, source, ref: source === 'web' ? 'https://example.test/page' : `${source}-ref`, title: 'Fixture Game', releaseDate, platforms: ['PC'], retrievedAt: '2026-11-10T12:00:00.000Z', status: 'ok', ...overrides,
});

describe('game research verification', () => {
  it('normalizes titles for matching without losing meaningful words', () => {
    expect(normalizeGameTitle('Hollow Knight: Silksong')).toBe('hollow knight silksong');
    expect(normalizeGameTitle('  ELDEN RING™ ')).toBe('elden ring');
    expect(normalizeGameTitle('Cyberpunk 2077')).not.toBe(normalizeGameTitle('Cyberpunk 2077: Phantom Liberty'));
  });

  it('confirms when two independent sources agree on the date', () => {
    const result = resolveGameVerification([observation('igdb', '2027-01-15'), observation('web', '2027-01-15', { ref: 'https://publisher.example/news' })]);
    expect(result).toMatchObject({ verification: 'confirmed', releaseDate: '2027-01-15', datePrecision: 'day', conflicts: [] });
    expect(result.agreeingSources).toEqual(['igdb', 'web']);
  });

  it('compares dates at the coarser precision and keeps the most precise one', () => {
    expect(resolveGameVerification([observation('igdb', '2027-01-15'), observation('rawg', '2027-01')])).toMatchObject({ verification: 'confirmed', releaseDate: '2027-01-15', datePrecision: 'day' });
  });

  it('marks a divergence as conflicting and says which sources disagree', () => {
    const result = resolveGameVerification([observation('igdb', '2027-01-15'), observation('rawg', '2027-03-02'), observation('web', '2027-01-15')]);
    expect(result.verification).toBe('conflicting');
    expect(result.conflicts).toEqual(['igdb 2027-01-15 ≠ rawg 2027-03-02', 'rawg 2027-03-02 ≠ web 2027-01-15']);
  });

  it('stays unconfirmed with a single source, with no date, or with unverified web pages', () => {
    expect(resolveGameVerification([observation('igdb', '2027-01-15')])).toMatchObject({ verification: 'unconfirmed', releaseDate: '2027-01-15' });
    expect(resolveGameVerification([observation('igdb', null), observation('rawg', null)])).toMatchObject({ verification: 'unconfirmed', releaseDate: null });
    expect(resolveGameVerification([observation('igdb', '2027-01-15'), observation('web', '2027-01-15', { status: 'unverified' })])).toMatchObject({ verification: 'unconfirmed' });
    expect(resolveGameVerification([])).toMatchObject({ verification: 'unconfirmed', releaseDate: null, platforms: [] });
  });

  it('does not count two pages of the same kind as two independent sources', () => {
    expect(resolveGameVerification([observation('web', '2027-01-15', { ref: 'https://a.example' }), observation('web', '2027-01-15', { ref: 'https://b.example' })]).verification).toBe('unconfirmed');
  });

  it('takes platforms from IGDB first and from the other sources only when IGDB has none', () => {
    expect(resolveGameVerification([observation('igdb', '2027-01-15', { platforms: ['PC (Microsoft Windows)', 'PlayStation 5'] }), observation('rawg', '2027-01-15', { platforms: ['PC'] })]).platforms).toEqual(['PC (Microsoft Windows)', 'PlayStation 5']);
    expect(resolveGameVerification([observation('igdb', '2027-01-15', { platforms: [] }), observation('rawg', '2027-01-15', { platforms: ['PC', 'Xbox Series S/X'] })]).platforms).toEqual(['PC', 'Xbox Series S/X']);
  });

  it('only accepts http(s) web references and valid partial dates', () => {
    expect(() => observation('web', '2027-01-15', { ref: 'javascript:alert(1)' })).toThrow();
    expect(() => observation('igdb', '2027-13-01')).toThrow();
    expect(() => observation('igdb', '15/01/2027')).toThrow();
  });
});
