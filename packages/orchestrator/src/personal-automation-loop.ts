export interface PersonalAutomationTick { tick(now: number): Promise<unknown>; }
interface TimerPort { intervalMs: number; now(): number; setInterval(callback: () => void, delay: number): ReturnType<typeof setInterval>; clearInterval(handle: ReturnType<typeof setInterval>): void; }

export class PersonalAutomationLoop {
  private handle: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private inFlight: Promise<unknown> | null = null;
  constructor(private readonly runtime: PersonalAutomationTick, private readonly timer: TimerPort = { intervalMs: 60_000, now: Date.now, setInterval, clearInterval }) {}
  start(): void { if (this.handle) return; void this.run(); this.handle = this.timer.setInterval(() => { void this.run(); }, this.timer.intervalMs); }
  stop(): void { if (!this.handle) return; this.timer.clearInterval(this.handle); this.handle = null; }
  private async run(): Promise<void> { if (this.running) return; this.running = true; this.inFlight = this.runtime.tick(this.timer.now()).catch(() => undefined); try { await this.inFlight; } finally { this.inFlight = null; this.running = false; } }
}
