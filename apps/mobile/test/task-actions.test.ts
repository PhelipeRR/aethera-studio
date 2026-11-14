import { describe, expect, it } from 'vitest';
import { isTerminalTask, remoteTaskInput } from '../src/task-actions';

describe('mobile task actions', () => {
  it('only offers continuation for terminal Core tasks', () => {
    expect(isTerminalTask('completed')).toBe(true);
    expect(isTerminalTask('failed')).toBe(true);
    expect(isTerminalTask('cancelled')).toBe(true);
    expect(isTerminalTask('running')).toBe(false);
  });

  it('creates a read-only task request owned by the Core', () => {
    expect(remoteTaskInput('  revisar o status  ')).toEqual({
      prompt: 'revisar o status',
      projectId: null,
      mode: 'auto',
      access: 'read-only',
    });
  });
});
