import { describe, expect, it } from 'vitest';
import { brandContrastRatio, channelConnectionSchema, generateBrandDirections, publishDraftSchema, validateBrandIdentity, validatePublishInput } from '../src/velix-channel.js';

describe('Velix channel contract', () => {
  it('never accepts credentials in the persisted connection or draft', () => {
    expect(channelConnectionSchema.parse({ schemaVersion: 1, status: 'connected', channelId: 'c1', title: 'Canal', handle: '@canal', scopes: ['youtube.readonly'], auditDeclared: false, connectedAt: '2026-11-03T00:00:00.000Z' })).not.toHaveProperty('accessToken');
    expect(publishDraftSchema.parse({ schemaVersion: 1, id: 'd1', videoAssetId: 'v1', title: 'Título', description: 'Descrição', tags: [], thumbnailPath: null, privacy: 'private', publishAt: null, categoryId: '22', madeForKids: false, scores: { title: 0, description: 0, tags: 0 }, status: 'draft', youtubeVideoId: null })).not.toHaveProperty('uploadSession');
  });
});

describe('Velix publication validation', () => {
  it('requires safe metadata and a fifteen-minute scheduling window', () => {
    expect(() => validatePublishInput({ title: '<script>', description: '', tags: [], privacy: 'private', publishAt: null })).toThrow(/título/);
    expect(() => validatePublishInput({ title: 'Vídeo', description: '', tags: [], privacy: 'public', publishAt: new Date(Date.now() + 16 * 60 * 1000).toISOString() })).toThrow(/privados/);
    expect(() => validatePublishInput({ title: 'Vídeo', description: '', tags: [], privacy: 'private', publishAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() })).toThrow(/15 minutos/);
  });
});

describe('Velix brand directions', () => {
  it('generates three deterministic reviewable directions without external claims', () => {
    const first = generateBrandDirections('ciência e tecnologia');
    expect(first).toHaveLength(3);
    expect(generateBrandDirections('ciência e tecnologia')).toEqual(first);
    expect(first.every((identity) => identity.source === 'created' && identity.approvedAt === null && identity.pieces.length === 0)).toBe(true);
    expect(first.every((identity) => brandContrastRatio(identity.tokens.foreground ?? '', identity.tokens.background ?? '') >= 4.5)).toBe(true);
    const firstDirection = first[0];
    expect(firstDirection).toBeDefined();
    if (firstDirection) expect(() => validateBrandIdentity({ ...firstDirection, tokens: { ...firstDirection.tokens, foreground: '#777777', background: '#ffffff' } })).toThrow(/AA/);
  });
});
