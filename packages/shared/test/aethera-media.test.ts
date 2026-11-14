import { describe, expect, it } from 'vitest';
import {
  candidateIdentitySignals,
  classifyVideoKind,
  exceedsAcquirableDuration,
  isOfficialChannel,
  sourceCandidateSchema,
  recommendSelection,
  rightsStatusForUsage,
  scoreCandidate,
  usageForCandidate,
  type SourceCandidate,
} from '../src/index.js';

// Synthetic candidates for fictional games; not real search results.
const subject = { id: 'run:igdb:1', title: 'Fixture Quest', aliases: ['FQ'], companies: ['Fixture Studio', 'Fixture Publishing'] };
const other = { id: 'run:igdb:2', title: 'Other Saga', aliases: [], companies: ['Other Corp'] };
const candidate = (overrides: Partial<SourceCandidate> = {}): SourceCandidate => sourceCandidateSchema.parse({
  schemaVersion: 1, id: 'c1', runId: 'run', subjectId: subject.id, referenceId: null, url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', source: 'youtube_search', kind: 'trailer',
  title: 'Fixture Quest - Official Trailer', channel: 'Fixture Publishing', channelVerified: true, official: true, durationSeconds: 120, maxHeight: 2160, publishedAt: '2026-06-01', license: null,
  thumbnailUrl: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg', score: 0, reasons: [], identity: null, status: 'proposed', discoveredAt: '2026-11-10T12:00:00.000Z', ...overrides,
});

describe('media candidates', () => {
  it('limits sources by kind: trailer 10 min, gameplay 60 min, unknown duration allowed', () => {
    expect(exceedsAcquirableDuration('trailer', 600)).toBe(false);
    expect(exceedsAcquirableDuration('trailer', 601)).toBe(true);
    expect(exceedsAcquirableDuration('gameplay', 3_600)).toBe(false);
    expect(exceedsAcquirableDuration('gameplay', 43_074)).toBe(true);
    expect(exceedsAcquirableDuration('gameplay', null)).toBe(false);
    expect(scoreCandidate(candidate({ kind: 'gameplay', durationSeconds: 43_074, identity: 'verified' }))).toEqual({ score: 0, reasons: ['acima do limite de 60 min para gameplay'] });
    const long = candidate({ id: 'long', kind: 'gameplay', durationSeconds: 43_074, score: 0.9, identity: 'verified' });
    const short = candidate({ id: 'short', kind: 'gameplay', durationSeconds: 1_200, score: 0.5, identity: 'verified' });
    expect(recommendSelection([long, short])).toEqual(['short']);
  });

  it('classifies a video by its title', () => {
    expect(classifyVideoKind('Fixture Quest - Official Launch Trailer')).toBe('trailer');
    expect(classifyVideoKind('Fixture Quest 20 Minutes of Gameplay')).toBe('gameplay');
    expect(classifyVideoKind('Fixture Quest Walkthrough Part 1')).toBe('gameplay');
    expect(classifyVideoKind('Fixture Quest developer interview')).toBe('other');
    expect(classifyVideoKind('FIXTURE QUEST - Official Gameplay Reveal')).toBe('trailer');
    expect(classifyVideoKind('Fixture Quest Gameplay PS5')).toBe('gameplay');
  });

  it('recognises an official channel by the companies IGDB lists', () => {
    expect(isOfficialChannel('Fixture Publishing', subject.companies)).toBe(true);
    expect(isOfficialChannel('FIXTURE STUDIO™', subject.companies)).toBe(true);
    expect(isOfficialChannel('Fixture Publishing America', subject.companies)).toBe(true);
    expect(isOfficialChannel('GameClipsDaily', subject.companies)).toBe(false);
    expect(isOfficialChannel('', subject.companies)).toBe(false);
    expect(isOfficialChannel('BANDAI NAMCO Europe', ['Bandai Namco Entertainment', 'FromSoftware'])).toBe(true);
    expect(isOfficialChannel('Namco Fans', ['Bandai Namco Entertainment'])).toBe(false);
    expect(isOfficialChannel('Official Games Channel', ['Bandai Namco Entertainment'])).toBe(false);
  });

  it('builds identity signals from provenance and the video title, before any download', () => {
    const igdbLinked = candidateIdentitySignals({ candidate: candidate({ source: 'igdb_video' }), subject, otherSubjects: [other] });
    expect(igdbLinked.map((signal) => [signal.source, signal.verdict])).toEqual([['provenance', 'match'], ['metadata_text', 'match']]);
    const wrongGame = candidateIdentitySignals({ candidate: candidate({ title: 'Other Saga - Gameplay Reveal', official: false, channel: 'Someone' }), subject, otherSubjects: [other] });
    expect(wrongGame).toContainEqual(expect.objectContaining({ source: 'metadata_text', verdict: 'mismatch', score: 0.9 }));
    const comparison = candidateIdentitySignals({ candidate: candidate({ title: 'Fixture Quest vs Other Saga comparison', official: false }), subject, otherSubjects: [other] });
    expect(comparison).toContainEqual(expect.objectContaining({ source: 'metadata_text', verdict: 'mismatch', score: 0.6 }));
  });

  it('keeps legal clearance apart: usage is editorial only for verified official media', () => {
    expect(usageForCandidate({ official: true, identity: 'verified' })).toBe('editorial_use');
    expect(usageForCandidate({ official: false, identity: 'verified' })).toBe('review_required');
    expect(usageForCandidate({ official: true, identity: 'review_required' })).toBe('review_required');
    expect(usageForCandidate({ official: true, identity: 'rejected' })).toBe('blocked');
    expect([rightsStatusForUsage('editorial_use'), rightsStatusForUsage('review_required'), rightsStatusForUsage('blocked')]).toEqual(['conditional', 'pending_review', 'blocked']);
  });

  it('scores 1080p+ official media of the wanted kind highest and explains why', () => {
    const best = scoreCandidate(candidate({ identity: 'verified' }));
    const lowRes = scoreCandidate(candidate({ identity: 'verified', maxHeight: 480 }));
    const unofficial = scoreCandidate(candidate({ identity: 'verified', official: false, channelVerified: false }));
    expect(best.score).toBeGreaterThan(lowRes.score);
    expect(best.score).toBeGreaterThan(unofficial.score);
    expect(best.reasons).toEqual(expect.arrayContaining(['canal oficial', 'identidade verificada', '2160p']));
    expect(scoreCandidate(candidate({ identity: 'rejected' })).score).toBe(0);
  });

  it('recommends one trailer and one gameplay per game, never a rejected or low-resolution source when better exists', () => {
    const pool = [
      candidate({ id: 't1', score: 0.9, identity: 'verified' }),
      candidate({ id: 't2', score: 0.95, identity: 'rejected' }),
      candidate({ id: 'g1', kind: 'gameplay', score: 0.7, identity: 'review_required', maxHeight: 1080 }),
      candidate({ id: 'g2', kind: 'gameplay', score: 0.8, identity: 'review_required', maxHeight: 360 }),
      candidate({ id: 'x1', kind: 'other', score: 0.99, identity: 'verified' }),
      candidate({ id: 'o1', subjectId: other.id, score: 0.5, identity: 'verified' }),
    ];
    expect(recommendSelection(pool).sort()).toEqual(['g1', 'o1', 't1']);
  });

  it('accepts only http(s) source URLs', () => {
    expect(() => candidate({ url: 'file:///C:/video.mp4' })).toThrow();
  });
});
