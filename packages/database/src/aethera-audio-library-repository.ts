import { desc, eq } from 'drizzle-orm';
import { musicTrackSchema, type MusicTrack } from '@neuralbridge/shared';
import type { Db } from './open.js';
import { aetheraMusicLibrary } from './schema.js';

export class AetheraAudioLibraryRepository {
  constructor(private readonly db: Db) {}

  saveMusicTrack(projectId: string, track: MusicTrack): MusicTrack {
    const parsed = musicTrackSchema.parse(track);
    const now = new Date().toISOString();
    this.db.insert(aetheraMusicLibrary).values({ id: parsed.id, projectId, dataJson: JSON.stringify(parsed), createdAt: parsed.importedAt, updatedAt: now }).onConflictDoUpdate({ target: [aetheraMusicLibrary.projectId, aetheraMusicLibrary.id], set: { dataJson: JSON.stringify(parsed), updatedAt: now } }).run();
    return parsed;
  }

  getMusicTrack(projectId: string, trackId: string): MusicTrack | null {
    const row = this.db.select().from(aetheraMusicLibrary).where(eq(aetheraMusicLibrary.projectId, projectId)).all().find((candidate) => candidate.id === trackId);
    return row ? musicTrackSchema.parse(JSON.parse(row.dataJson)) : null;
  }

  listMusicTracks(projectId: string): MusicTrack[] {
    return this.db.select().from(aetheraMusicLibrary).where(eq(aetheraMusicLibrary.projectId, projectId)).orderBy(desc(aetheraMusicLibrary.updatedAt)).all().map((row) => musicTrackSchema.parse(JSON.parse(row.dataJson)));
  }
}
