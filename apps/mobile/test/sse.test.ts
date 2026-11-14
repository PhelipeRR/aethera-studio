import { describe, expect, it } from 'vitest';
import { parseSseBuffer } from '../src/sse';

describe('mobile SSE parser', () => {
  it('parses complete frames and keeps an incomplete frame for the next chunk', () => {
    const first = parseSseBuffer('id: 7\nevent: task.status\ndata: {"v":1}\n\nid: 8\ndata: {"v":2}');
    expect(first.events).toEqual([{ id: 7, event: 'task.status', data: '{"v":1}' }]);
    expect(first.rest).toBe('id: 8\ndata: {"v":2}');
  });

  it('joins multiple data lines as one JSON payload', () => {
    const result = parseSseBuffer('id: 9\nevent: task.log\ndata: {"v":\ndata: 1}\n\n');
    expect(result.events[0]).toEqual({ id: 9, event: 'task.log', data: '{"v":\n1}' });
    expect(result.rest).toBe('');
  });
});
