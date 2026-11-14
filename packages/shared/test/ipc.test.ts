import { describe, expect, it } from 'vitest';
import { IpcChannel, parseIpcInput, parseIpcOutput, splitLearnings } from '../src/index.js';

describe('ipc contract', () => {
  it('validates extension management inputs and rejects traversal-like identifiers', () => {
    expect(parseIpcInput(IpcChannel.extensionsInstall, { sourcePath: 'C:/extensions/neura' })).toEqual({ sourcePath: 'C:/extensions/neura' });
    expect(parseIpcInput(IpcChannel.extensionsDisable, { id: 'neura' })).toEqual({ id: 'neura' });
    expect(() => parseIpcInput(IpcChannel.extensionsDisable, { id: '../neura' })).toThrow();
  });
  it('validates transactional skill installation intents and rejects renderer paths', () => {
    const input = { skillId: 'remotion', source: 'https://github.com/example/skills.git', scope: 'global', agent: 'codex' };
    expect(parseIpcInput(IpcChannel.skillsInstallPrepare, input)).toEqual(input);
    expect(parseIpcInput(IpcChannel.skillsInstallConfirm, { operationId: '00000000-0000-4000-8000-000000000001', confirmed: true })).toMatchObject({ operationId: '00000000-0000-4000-8000-000000000001' });
    expect(() => parseIpcInput(IpcChannel.skillsInstallPrepare, { ...input, destination: 'C:/outside' })).toThrow();
    expect(() => parseIpcInput(IpcChannel.skillsInstallConfirm, { operationId: '00000000-0000-4000-8000-000000000001', confirmed: false })).toThrow();
  });

  it('validates Skill Studio drafts and rejects auxiliary traversal in IPC', () => {
    const metadata = { name: 'Studio', description: 'Safe', objective: '', triggers: [], agents: ['claude'], dependencies: [], permissions: [], examples: [] };
    expect(parseIpcInput(IpcChannel.skillsStudioCreate, { skillId: 'studio', metadata, instructions: '# Instructions', scope: 'global' })).toMatchObject({ skillId: 'studio' });
    expect(() => parseIpcInput(IpcChannel.skillsStudioSave, { draftId: '00000000-0000-4000-8000-000000000001', expectedRevision: 1, metadata, instructions: '# Instructions', files: [{ path: '../escape.md', content: 'blocked' }] })).toThrow();
    expect(() => parseIpcInput(IpcChannel.skillsStudioPublish, { draftId: '00000000-0000-4000-8000-000000000001', confirmed: false })).toThrow();
  });

  it('accepts every supported theme source', () => {
    for (const source of ['dark', 'light', 'system'] as const) {
      expect(parseIpcInput(IpcChannel.themeSet, { source })).toEqual({ source });
    }
  });

  it('rejects unknown theme sources and extra keys', () => {
    expect(() => parseIpcInput(IpcChannel.themeSet, { source: 'blue' })).toThrow();
    expect(() => parseIpcInput(IpcChannel.themeSet, { source: 'dark', cmd: 'calc.exe' })).toThrow();
    expect(() => parseIpcInput(IpcChannel.themeSet, 'dark')).toThrow();
  });

  it('rejects payloads on channels that take no input', () => {
    expect(parseIpcInput(IpcChannel.appInfo, undefined)).toBeUndefined();
    expect(() => parseIpcInput(IpcChannel.appInfo, { path: 'C:/' })).toThrow();
  });

  it('validates handler output', () => {
    expect(() => parseIpcOutput(IpcChannel.themeGet, 'neon')).toThrow();
    expect(parseIpcOutput(IpcChannel.themeGet, 'light')).toBe('light');
  });

  it('exposes the Aethera visual-index action with only a production run id', () => {
    const input = { runId: '00000000-0000-4000-8000-000000000001' };
    expect(parseIpcInput(IpcChannel.videoProductionRunVisualIndex, input)).toEqual(input);
    expect(() => parseIpcInput(IpcChannel.videoProductionRunVisualIndex, { ...input, path: 'C:/outside' })).toThrow();
  });

  it('exposes the read-only AS-10 evidence validation action with only a bounded root', () => {
    const input = { root: 'C:/dev/aethera-reference-media' };
    expect(parseIpcInput(IpcChannel.videoProductionReferenceValidation, input)).toEqual(input);
    expect(() => parseIpcInput(IpcChannel.videoProductionReferenceValidation, { ...input, runId: 'unexpected' })).toThrow();
  });

  it('keeps degraded database recovery actions inside the IPC contract', () => {
    const configuration = { ok: true, file: 'preferences.json' };
    expect(parseIpcOutput(IpcChannel.appStatus, { database: { ok: false, file: 'db/brain.db', reason: 'corrupt', recovery: 'restore-backup' }, configuration })).toEqual({ database: { ok: false, file: 'db/brain.db', reason: 'corrupt', recovery: 'restore-backup' }, configuration });
    expect(parseIpcOutput(IpcChannel.appStatus, { database: { ok: false, file: 'db/brain.db', reason: 'disk-full', recovery: 'free-disk-space' }, configuration: { ok: false, file: 'preferences.json', reason: 'invalid', preservedAs: 'preferences.json.invalid-x', recovery: 'review-configuration' } })).toMatchObject({ database: { reason: 'disk-full' } });
    expect(() => parseIpcOutput(IpcChannel.appStatus, { database: { ok: false, file: 'db/brain.db', reason: 'corrupt' }, configuration })).toThrow();
    expect(() => parseIpcOutput(IpcChannel.appStatus, { database: { ok: true, file: 'db/brain.db' } })).toThrow();
    expect(() => parseIpcInput(IpcChannel.databaseRestoreBackup, { name: 'x', path: 'C:/evil.db' })).toThrow();
  });
});

describe('brain channels', () => {
  it('validate memory writes from the renderer with the same rules as MCP clients', () => {
    expect(parseIpcInput(IpcChannel.brainStore, { title: 'Ok', content: 'x', type: 'decision' })).toMatchObject({ title: 'Ok', tags: [], links: [] });
    for (const bad of [
      { title: 'a [[b]]', content: 'x', type: 'decision' },
      { title: 'Ok', content: 'x', type: 'gossip' },
      { title: '', content: 'x', type: 'decision' },
      { title: 'Ok', content: 'x', type: 'decision', sql: 'DROP TABLE' },
    ]) {
      expect(() => parseIpcInput(IpcChannel.brainStore, bad)).toThrow();
    }
  });

  it('require ids and an explicit hard flag for deletes', () => {
    expect(parseIpcInput(IpcChannel.brainDelete, { id: 'abc', hard: false })).toEqual({ id: 'abc', hard: false });
    expect(() => parseIpcInput(IpcChannel.brainDelete, { id: 'abc' })).toThrow();
    expect(() => parseIpcInput(IpcChannel.brainGet, { id: '' })).toThrow();
  });

  it('bound searches', () => {
    expect(() => parseIpcInput(IpcChannel.brainSearch, { query: 'x'.repeat(501) })).toThrow();
    expect(() => parseIpcInput(IpcChannel.brainSearch, { query: 'x', limit: 1000 })).toThrow();
    expect(parseIpcInput(IpcChannel.brainSearch, { query: 'redis', projectId: null })).toEqual({ query: 'redis', projectId: null });
  });
});

describe('task channels', () => {
  it('accept a request with a known mode and an optional project, and nothing else', () => {
    expect(parseIpcInput(IpcChannel.tasksStart, { prompt: '  Explique o cache  ', projectId: null, mode: 'auto' })).toEqual({ prompt: 'Explique o cache', projectId: null, mode: 'auto' });
    for (const bad of [
      { prompt: '   ', projectId: null, mode: 'auto' },
      { prompt: 'x', projectId: null, mode: 'turbo' },
      { prompt: 'x', mode: 'auto' },
      { prompt: 'x'.repeat(20_001), projectId: null, mode: 'auto' },
      { prompt: 'x', projectId: null, mode: 'auto', approved: true },
    ]) {
      expect(() => parseIpcInput(IpcChannel.tasksStart, bad)).toThrow();
    }
  });

  it('bound list filters', () => {
    expect(parseIpcInput(IpcChannel.tasksList, { status: 'failed', agent: 'codex' })).toEqual({ status: 'failed', agent: 'codex' });
    expect(() => parseIpcInput(IpcChannel.tasksList, { status: 'exploded' })).toThrow();
    expect(() => parseIpcInput(IpcChannel.tasksList, { limit: 5000 })).toThrow();
  });

  it('validates the swarm planner budget before it reaches the orchestrator', () => {
    expect(parseIpcInput(IpcChannel.tasksSwarmPlan, { prompt: 'avaliar a arquitetura', tokenBudget: 100_000 })).toEqual({ prompt: 'avaliar a arquitetura', tokenBudget: 100_000 });
    expect(parseIpcInput(IpcChannel.tasksSwarmPlan, { prompt: 'avaliar a arquitetura' })).toEqual({ prompt: 'avaliar a arquitetura' });
    for (const bad of [
      { prompt: '   ' },
      { prompt: 'x'.repeat(20_001) },
      { prompt: 'x', tokenBudget: 9_999 },
      { prompt: 'x', tokenBudget: 50_000_001 },
      { prompt: 'x', tokenBudget: 1.5 },
      { prompt: 'x', tokenBudget: 100_000, extra: true },
    ]) {
      expect(() => parseIpcInput(IpcChannel.tasksSwarmPlan, bad)).toThrow();
    }
  });
});

describe('learnings block', () => {
  it('is split from the answer, and a malformed one is hidden without proposals', () => {
    const answer = 'Corrigi o pool.\n\n```neuralbridge-learnings\n[{"title":"Pool","content":"20 conexões","type":"bug_fix"}]\n```\n';
    expect(splitLearnings(answer)).toEqual({ text: 'Corrigi o pool.', proposals: [{ title: 'Pool', content: '20 conexões', type: 'bug_fix' }] });
    expect(splitLearnings('Feito.\n```neuralbridge-learnings\nnão é json\n```')).toEqual({ text: 'Feito.', proposals: [] });
    expect(splitLearnings('Sem bloco.\n```ts\nconst a = 1;\n```')).toEqual({ text: 'Sem bloco.\n```ts\nconst a = 1;\n```', proposals: [] });
  });
});

describe('conversation channels', () => {
  it('accept model names as CLIs write them, and nothing that looks like an option or a command', () => {
    for (const model of ['opus', 'claude-sonnet-4-5', 'gpt-5.1-codex', 'claude-opus-4-1[1m]', null]) {
      expect(parseIpcInput(IpcChannel.tasksStart, { prompt: 'x', projectId: null, mode: 'claude', model })).toMatchObject({ model });
    }
    for (const model of ['--dangerously-skip-permissions', 'opus; rm -rf /', '', 'a'.repeat(101)]) {
      expect(() => parseIpcInput(IpcChannel.tasksStart, { prompt: 'x', projectId: null, mode: 'claude', model })).toThrow();
    }
    expect(() => parseIpcInput(IpcChannel.tasksRenameThread, { id: 't', title: 'x'.repeat(121) })).toThrow();
  });
});

describe('chat panel channels', () => {
  it('open or reveal a run output only by task, path and a known action', () => {
    expect(parseIpcInput(IpcChannel.tasksOutputFile, { id: 't', path: 'docs/a.md', action: 'reveal' })).toEqual({ id: 't', path: 'docs/a.md', action: 'reveal' });
    expect(() => parseIpcInput(IpcChannel.tasksOutputFile, { id: 't', path: 'a.md', action: 'run' })).toThrow();
    expect(() => parseIpcInput(IpcChannel.tasksOutputFile, { id: 't', path: '', action: 'open' })).toThrow();
  });

  it('list MCP servers with names and states only', () => {
    const list = { clients: [{ id: 'codex', installed: true, servers: [{ name: 'context7', transport: 'stdio', status: 'not_checked', detail: null }], error: null }], checkedAt: '2026-10-29T10:00:00.000Z' };
    expect(parseIpcOutput(IpcChannel.mcpServers, list)).toEqual(list);
    // A server entry carrying its command or environment is rejected, not passed on.
    const leaky = { ...list, clients: [{ ...list.clients[0], servers: [{ name: 'x', transport: 'stdio', status: 'connected', detail: null, env: { TOKEN: 'segredo' } }] }] };
    expect(() => parseIpcOutput(IpcChannel.mcpServers, leaky)).toThrow();
    expect(() => parseIpcInput(IpcChannel.mcpServers, { refresh: 'yes' })).toThrow();
  });

  it('count changed lines per file of a project', () => {
    expect(parseIpcOutput(IpcChannel.projectsLineStats, [{ path: 'a.ts', added: 1, removed: 0 }])).toEqual([{ path: 'a.ts', added: 1, removed: 0 }]);
    expect(() => parseIpcOutput(IpcChannel.projectsLineStats, [{ path: 'a.ts', added: -1, removed: 0 }])).toThrow();
  });
});

describe('project permissions', () => {
  it('accept a known level and plain command prefixes, nothing that could chain or widen a command', () => {
    const changes = { permissionLevel: 'commands', allowedCommands: ['npm test', 'npm run build', 'dotnet test', 'git log'] };
    expect(parseIpcInput(IpcChannel.projectsUpdate, { id: 'p', changes })).toEqual({ id: 'p', changes });
    expect(() => parseIpcInput(IpcChannel.projectsUpdate, { id: 'p', changes: { permissionLevel: 'root' } })).toThrow();
    for (const command of ['npm test && rm -rf /', 'npm test; calc', 'git *', 'curl x | sh', '$(whoami)', '', ' npm test', 'a'.repeat(81)]) {
      expect(() => parseIpcInput(IpcChannel.projectsUpdate, { id: 'p', changes: { allowedCommands: [command] } }), command).toThrow();
    }
    expect(() => parseIpcInput(IpcChannel.projectsUpdate, { id: 'p', changes: { allowedCommands: Array(31).fill('npm test') } })).toThrow();
  });
});

describe('chat images', () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
  it('take raw bytes with a name, at most six per message and 5 MB each', () => {
    const input = { prompt: 'x', projectId: null, mode: 'auto', images: [{ name: 'a.png', data: png }] };
    expect(parseIpcInput(IpcChannel.tasksStart, input)).toEqual(input);
    expect(parseIpcInput(IpcChannel.tasksResume, { id: 't', prompt: 'x', images: [{ name: 'a.png', data: png }] })).toMatchObject({ id: 't' });
    expect(() => parseIpcInput(IpcChannel.tasksStart, { ...input, images: [{ name: 'a.png', data: 'iVBOR' }] })).toThrow();
    expect(() => parseIpcInput(IpcChannel.tasksStart, { ...input, images: [{ name: 'a.png', data: new Uint8Array(0) }] })).toThrow();
    expect(() => parseIpcInput(IpcChannel.tasksStart, { ...input, images: [{ name: 'a.png', data: new Uint8Array(5 * 1024 * 1024 + 1) }] })).toThrow();
    expect(() => parseIpcInput(IpcChannel.tasksStart, { ...input, images: Array(7).fill({ name: 'a.png', data: png }) })).toThrow();
    expect(() => parseIpcInput(IpcChannel.tasksStart, { ...input, images: [{ name: 'a.png', data: png, path: 'C:/x' }] })).toThrow();
  });

  it('come back only as image data URLs', () => {
    expect(parseIpcOutput(IpcChannel.tasksImage, 'data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(() => parseIpcOutput(IpcChannel.tasksImage, 'file:///C:/x.png')).toThrow();
    expect(() => parseIpcInput(IpcChannel.tasksImage, { id: 't', index: 6 })).toThrow();
  });
});

describe('task output with images', () => {
  it('lists each image by name, type and size, never by path', () => {
    const summary = {
      id: 't', prompt: 'x', projectId: null, projectName: null, mode: 'auto', status: 'completed', parentTaskId: null, threadId: 't', threadTitle: null, model: null,
      summary: null, error: null, createdAt: 'a', startedAt: null, finishedAt: null, agents: [], tokens: { input: null, output: null, cached: null, costUsd: null }, filesChanged: 0,
      images: [{ name: 'a.png', mime: 'image/png', size: 4 }],
    };
    expect(parseIpcOutput(IpcChannel.tasksList, [summary])).toEqual([summary]);
    expect(() => parseIpcOutput(IpcChannel.tasksList, [{ ...summary, images: [{ name: 'a.png', mime: 'image/png', size: 4, path: 'C:/x' }] }])).toThrow();
    expect(() => parseIpcOutput(IpcChannel.tasksList, [{ ...summary, images: [{ name: 'a.svg', mime: 'image/svg+xml', size: 4 }] }])).toThrow();
  });
});

describe('project profile channels (Phase 21)', () => {
  const profile = {
    projectId: 'loja',
    generatedAt: '2026-10-29T12:00:00.000Z',
    index: { files: 2, indexed: 2, skipped: 0, removed: 0, tooLarge: 0, limited: false },
    stack: { stacks: ['node'], packageManager: 'npm', evidence: { node: 'package.json' } },
    modules: [{ path: 'src', files: 2, symbolCount: 1, symbols: ['main'] }],
    dependencies: [{ name: 'react', version: '19.3.0', kind: 'runtime', source: 'package.json' }],
    decisions: [{ id: 'm1', title: 'Monorepo', confidence: 'reviewed' }],
    problems: [{ tag: 'postgres', occurrences: 2, memories: [{ id: 'm2', title: 'Timeout', confidence: 'unverified' }] }],
    changes: null,
  };
  it('carry the profile, or null before the first one, and nothing more', () => {
    expect(parseIpcOutput(IpcChannel.projectsProfile, profile)).toEqual(profile);
    expect(parseIpcOutput(IpcChannel.projectsProfile, null)).toBeNull();
    expect(parseIpcOutput(IpcChannel.projectsProfileRefresh, profile)).toEqual(profile);
    expect(() => parseIpcOutput(IpcChannel.projectsProfile, { ...profile, rootPath: 'C:/src' })).toThrow();
    expect(() => parseIpcInput(IpcChannel.projectsProfileRefresh, { id: '' })).toThrow();
  });
});

describe('git reference security (enhanced validation)', () => {
  it('rejects Git references with path traversal attempts', () => {
    expect(() => parseIpcInput(IpcChannel.projectsGitCompare, { id: 'loja', left: '../../etc/passwd', right: 'main', mode: 'direct' })).toThrow();
    expect(() => parseIpcInput(IpcChannel.projectsGitCompare, { id: 'loja', left: 'main', right: '../..', mode: 'direct' })).toThrow();
    expect(() => parseIpcInput(IpcChannel.projectsGitCompare, { id: 'loja', left: 'main', right: '/etc/passwd', mode: 'direct' })).toThrow();
    expect(() => parseIpcInput(IpcChannel.projectsGitCompare, { id: 'loja', left: 'main~', right: 'main', mode: 'direct' })).toThrow();
  });
  it('accepts only safe Git reference characters', () => {
    expect(parseIpcInput(IpcChannel.projectsGitCompare, { id: 'loja', left: 'feature/awesome', right: 'release/v1.0', mode: 'direct' })).toEqual({ id: 'loja', left: 'feature/awesome', right: 'release/v1.0', mode: 'direct' });
    expect(parseIpcInput(IpcChannel.projectsGitCompare, { id: 'loja', left: 'main~2', right: 'dev^1', mode: 'merge-base' })).toEqual({ id: 'loja', left: 'main~2', right: 'dev^1', mode: 'merge-base' });
  });
  it('blocks empty or null Git references', () => {
    expect(() => parseIpcInput(IpcChannel.projectsGitCompare, { id: 'loja', left: '', right: 'main', mode: 'direct' })).toThrow();
    expect(() => parseIpcInput(IpcChannel.projectsGitCompare, { id: 'loja', left: null, right: 'main', mode: 'direct' })).toThrow();
  });
});

describe('git history channels (Phase 25)', () => {
  it('take a project and a plain query or commit hash, nothing else', () => {
    expect(parseIpcInput(IpcChannel.projectsGitSearch, { id: 'loja', query: 'timeout' })).toEqual({ id: 'loja', query: 'timeout' });
    expect(() => parseIpcInput(IpcChannel.projectsGitSearch, { id: 'loja', query: '   ' })).toThrow();
    expect(parseIpcInput(IpcChannel.projectsGitRelations, { id: 'loja', hash: 'a1b2c3d4e5f6' })).toMatchObject({ hash: 'a1b2c3d4e5f6' });
    for (const hash of ['HEAD', 'main', '--all', 'a1b2c3d4; rm -rf /']) expect(() => parseIpcInput(IpcChannel.projectsGitRelations, { id: 'loja', hash })).toThrow();
  });
});

describe('Smart Commit channels (Phase 38.5)', () => {
  it('accepts a provider selection and exposes a persisted proposal without write authority', () => {
    const input = { projectId: 'loja', agent: 'codex' };
    expect(parseIpcInput(IpcChannel.tasksSmartCommitStart, input)).toEqual(input);
    const proposal = {
      taskId: 'task-1',
      agent: 'codex',
      generatedAt: '2026-11-01T12:00:00.000Z',
      files: ['src/auth.ts'],
      truncated: false,
      proposal: {
        subject: 'fix(auth): reject expired token',
        body: 'Keep the staged change explicit.',
        prTitle: 'Reject expired tokens',
        prBody: '## Summary\nReject expired tokens.',
        checklist: ['Tests still need to be run'],
        changelog: 'Fixed token validation.',
        documentationImpact: 'No documentation update identified.',
      },
    };
    expect(parseIpcOutput(IpcChannel.tasksSmartCommitGet, proposal)).toEqual(proposal);
    expect(() => parseIpcInput(IpcChannel.tasksSmartCommitStart, { ...input, command: 'git commit' })).toThrow();
  });
});
