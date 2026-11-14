/**
 * SYNTHETIC fixtures shaped after the public IGDB v4 and RAWG documentation. They are NOT recorded responses and do
 * NOT describe real games: titles, ids and dates are invented so tests never pass off made-up data as real research.
 */
import type { IgdbGame } from '../../src/aethera/game-sources.js';

const RAW_GAMES: unknown[] = [
  {
    id: 900001, name: 'Fixture Quest', slug: 'fixture-quest', url: 'https://www.igdb.com/games/fixture-quest',
    alternative_names: [{ id: 1, name: 'FQ' }],
    first_release_date: Date.UTC(2027, 0, 15) / 1_000,
    release_dates: [{ id: 11, date: Date.UTC(2027, 0, 15) / 1_000, y: 2027, m: 1, d: 15, date_format: { id: 1, format: 'YYYYMMMMDD' } }],
    platforms: [{ id: 6, name: 'PC (Microsoft Windows)' }, { id: 167, name: 'PlayStation 5' }],
    involved_companies: [{ id: 21, company: { id: 31, name: 'Fixture Studio' }, developer: true, publisher: false }, { id: 22, company: { id: 32, name: 'Fixture Publishing' }, developer: false, publisher: true }],
    websites: [{ id: 41, url: 'https://fixture-quest.example/' }],
    screenshots: [{ id: 51, image_id: 'synthshot1' }],
    artworks: [{ id: 61, image_id: 'syntharte1' }],
  },
  {
    id: 900002, name: 'Fixture Quest: Expansion', slug: 'fixture-quest-expansion', url: 'https://www.igdb.com/games/fixture-quest-expansion',
    first_release_date: Date.UTC(2027, 5, 1) / 1_000, release_dates: [{ id: 12, date: Date.UTC(2027, 5, 1) / 1_000, y: 2027, m: 6, d: 1 }], parent_game: 900001,
  },
  {
    id: 900003, name: 'Fixture Silk', slug: 'fixture-silk', url: 'https://www.igdb.com/games/fixture-silk',
    first_release_date: Date.UTC(2027, 11, 31) / 1_000,
    release_dates: [{ id: 13, date: Date.UTC(2027, 11, 31) / 1_000, y: 2027, date_format: { id: 3, format: 'YYYY' } }],
    platforms: [{ id: 130, name: 'Nintendo Switch' }],
  },
];
/** Extra fields (ids) stay, as in a real reply; the client's schema ignores what it does not use. */
export const SYNTHETIC_IGDB_GAMES = RAW_GAMES as IgdbGame[];

export const SYNTHETIC_TOKEN = { access_token: 'synthetic-access-token', expires_in: 3_600, token_type: 'bearer' } as const;

export const SYNTHETIC_RAWG_SEARCH = {
  count: 1,
  results: [{ id: 700001, slug: 'fixture-quest', name: 'Fixture Quest', released: '2027-01-15', tba: false, platforms: [{ platform: { id: 4, name: 'PC' } }] }],
} as const;
