import { describe, expect, it } from 'vitest';
import { dedupeGitEvent, matchGitTrigger, validateGitRef } from '../src/git-triggers.js';
describe('git triggers', () => {
  it('rejects option-like refs and accepts normal refs', () => { expect(validateGitRef('--upload-pack=x')).toBe(false); expect(validateGitRef('feature/login')).toBe(true); });
  it('matches changed paths with a safe glob', () => { expect(matchGitTrigger({ paths: ['src/a.ts'] }, { pathGlobs: ['src/**/*.ts'] })).toBe(true); });
  it('deduplicates by automation and commit', () => { expect(dedupeGitEvent({ automationId: 'a', ref: 'main', commitHash: 'h' }, new Set(['a:main:h']))).toBe(false); });
});
