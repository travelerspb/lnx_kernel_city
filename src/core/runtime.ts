// Pulls events from a source, validates and applies them, and emits each one
// on the bus. Supports run-until-time, step-one-event and reset.

import { apply, initialState } from './apply';
import type { Bus } from './bus';
import { createValidator, type StreamValidator } from './validate';
import type { EventSource, KEvent, KernelState } from './types';

export class Runtime {
  private _state: KernelState;
  private validator: StreamValidator;

  constructor(
    readonly source: EventSource,
    private readonly bus?: Bus,
  ) {
    this._state = initialState(source.header);
    this.validator = createValidator(source.header);
  }

  get state(): Readonly<KernelState> {
    return this._state;
  }

  /** Timestamp of the next event, or null at the end of the stream. */
  peek(): number | null {
    return this.source.peek();
  }

  get done(): boolean {
    return this.source.peek() === null;
  }

  /** Apply exactly one event. Returns it, or null at the end of the stream. */
  step(): KEvent | null {
    if (this.source.peek() === null) return null;
    const ev = this.source.next(this._state);
    const issues = this.validator.check(ev);
    if (issues.length > 0) {
      throw new Error(`invalid event seq ${ev.seq}: ${issues.map((i) => i.message).join('; ')}`);
    }
    apply(this._state, ev);
    this.bus?.emit('kevent', { event: ev, state: this._state });
    if (this.source.peek() === null) this.bus?.emit('sim:end', { state: this._state });
    return ev;
  }

  /** Apply every event with ts <= t. Returns the number applied. */
  runUntil(t: number, maxEvents = 10_000): number {
    let n = 0;
    for (let next = this.source.peek(); next !== null && next <= t && n < maxEvents; next = this.source.peek()) {
      this.step();
      n++;
    }
    return n;
  }

  /** Run to the end of the stream. Returns the number applied. */
  runToEnd(maxEvents = 1_000_000): number {
    let n = 0;
    while (n < maxEvents && this.step()) n++;
    return n;
  }

  reset(): void {
    this.source.reset();
    this._state = initialState(this.source.header);
    this.validator = createValidator(this.source.header);
    this.bus?.emit('sim:reset', { header: this.source.header, state: this._state });
  }
}
