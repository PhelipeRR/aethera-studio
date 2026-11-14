export interface SseEvent {
  id: number;
  event: string | null;
  data: string;
}

export function parseSseBuffer(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = [];
  const frames = buffer.split(/\r?\n\r?\n/);
  const rest = frames.pop() ?? '';
  for (const frame of frames) {
    let id: number | null = null;
    let event: string | null = null;
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      const separator = line.indexOf(':');
      const field = separator < 0 ? line : line.slice(0, separator);
      const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
      if (field === 'id' && /^\d+$/.test(value)) id = Number(value);
      else if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (id !== null && data.length > 0) events.push({ id, event, data: data.join('\n') });
  }
  return { events, rest };
}
