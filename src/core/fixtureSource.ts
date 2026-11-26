// An EventSource over a recorded array of events: a fixture now, a converted
// real trace in Stage 6. It ignores the state it is given.

import type { EventSource, KEvent, StreamHeader } from './types';

export interface EventFile {
  header: StreamHeader;
  events: KEvent[];
}

export class FixtureSource implements EventSource {
  private i = 0;

  constructor(private readonly file: EventFile) {}

  get header(): StreamHeader {
    return this.file.header;
  }

  peek(): number | null {
    return this.file.events[this.i]?.ts ?? null;
  }

  next(): KEvent {
    const ev = this.file.events[this.i];
    if (!ev) throw new Error('FixtureSource: stream has ended');
    this.i++;
    return ev;
  }

  reset(): void {
    this.i = 0;
  }
}
