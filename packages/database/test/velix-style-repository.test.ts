import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE_CHOICE } from '@neuralbridge/shared';
import { openDatabase, PROJECT_DEFAULT_VIDEO, velixVideoStyles, videoProjects, VelixStyleRepository } from '../src/index.js';

const open = () => { const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-styles-')), 'db.sqlite'), { migrationsFolder: join(import.meta.dirname, '../migrations') }); handle.db.insert(videoProjects).values({ id: 'p1', name: 'Canal', rootPath: 'C:/canal' }).run(); return handle; };
const withOption = (value: string) => ({ ...DEFAULT_STYLE_CHOICE, options: { marca: value } });

describe('VelixStyleRepository', () => {
  it('keeps one style per video, falling back to the project default and then to none (the Dossiê)', () => {
    const handle = open();
    const repository = new VelixStyleRepository(handle.db);
    expect(repository.load('p1', 'video-a')).toBeNull();
    repository.save('p1', PROJECT_DEFAULT_VIDEO, withOption('projeto'));
    expect(repository.load('p1', 'video-a')?.options).toEqual({ marca: 'projeto' });
    expect(repository.hasOwn('p1', 'video-a')).toBe(false);
    repository.save('p1', 'video-a', withOption('a'));
    expect(repository.load('p1', 'video-a')?.options).toEqual({ marca: 'a' });
    expect(repository.load('p1', 'video-b')?.options).toEqual({ marca: 'projeto' });
    expect(repository.hasOwn('p1', 'video-a')).toBe(true);
    repository.clear('p1', 'video-a');
    expect(repository.load('p1', 'video-a')?.options).toEqual({ marca: 'projeto' });
    repository.clear('p1', PROJECT_DEFAULT_VIDEO);
    expect(repository.load('p1', 'video-a')).toBeNull();
    handle.close();
  });

  it('refuses invalid choices and reads a stale stored choice as none', () => {
    const handle = open();
    const repository = new VelixStyleRepository(handle.db);
    expect(() => repository.save('p1', 'video-a', { ...DEFAULT_STYLE_CHOICE, styleId: 'nao-existe' })).toThrow(/desconhecido/);
    handle.db.insert(velixVideoStyles).values({ projectId: 'p1', videoName: 'video-a', data: JSON.stringify({ ...DEFAULT_STYLE_CHOICE, styleId: 'removido' }) }).run();
    expect(repository.load('p1', 'video-a')).toBeNull();
    handle.close();
  });

  it('removes the choices with their project', () => {
    const handle = open();
    const repository = new VelixStyleRepository(handle.db);
    repository.save('p1', 'video-a', DEFAULT_STYLE_CHOICE);
    repository.save('p1', PROJECT_DEFAULT_VIDEO, DEFAULT_STYLE_CHOICE);
    handle.db.delete(videoProjects).run();
    expect(handle.db.select().from(velixVideoStyles).all()).toEqual([]);
    handle.close();
  });
});
