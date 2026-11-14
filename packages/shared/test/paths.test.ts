import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDataDir } from '../src/paths.js';

describe('resolveDataDir', () => {
  it('uses %APPDATA%\\NeuralBridge by default', () => {
    expect(resolveDataDir({ APPDATA: 'C:\\Users\\Ana\\AppData\\Roaming' })).toBe(join('C:\\Users\\Ana\\AppData\\Roaming', 'NeuralBridge'));
  });

  it('honours NB_DATA_DIR so tests and portable setups can isolate data', () => {
    expect(resolveDataDir({ APPDATA: 'C:\\x', NB_DATA_DIR: 'D:\\nb data' })).toBe('D:\\nb data');
  });

  it('fails clearly when no location can be determined', () => {
    expect(() => resolveDataDir({})).toThrow(/APPDATA/);
  });
});
