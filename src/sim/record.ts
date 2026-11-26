// Run an event source to the end through the runtime (validate + apply) and
// collect its stream. Used by tests and to regenerate the fixture (WP5).

import type { EventFile } from '../core/fixtureSource';
import { Runtime } from '../core/runtime';
import type { EventSource, KEvent } from '../core/types';
import { createSim, type SimOptions } from './model';

export function recordSim(opts: SimOptions | { source: EventSource }): EventFile {
  const source = 'source' in opts ? opts.source : createSim(opts);
  const rt = new Runtime(source);
  const events: KEvent[] = [];
  for (let ev = rt.step(); ev; ev = rt.step()) events.push(ev);
  return { header: source.header, events };
}
