// ARCHITECTURE.md rule 5 and Stage 1 exit criterion 5: the same seed gives a
// byte-identical event stream; a different seed changes only timings and CPU
// choices.

import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED } from '../src/core/rng';
import type { KEvent } from '../src/core/types';
import { createSim } from '../src/sim/model';
import { recordSim } from '../src/sim/record';
import { COLD_WARM_READ } from '../src/sim/scenarios';

const json = (seed: number) => JSON.stringify(recordSim({ seed, scenario: COLD_WARM_READ }));

/** An event without the fields a seed is allowed to change. */
function shape(ev: KEvent): Record<string, unknown> {
  const { ts: _ts, cpu: _cpu, pid: _pid, ...rest } = ev as KEvent & { targetCpu?: number };
  const out: Record<string, unknown> = { ...rest };
  delete out['targetCpu'];
  return out;
}

describe('determinism', () => {
  it('the same seed gives a byte-identical stream twice', () => {
    expect(json(DEFAULT_SEED)).toBe(json(DEFAULT_SEED));
    expect(json(7)).toBe(json(7));
  });

  it('reset() replays the same stream', () => {
    const a = recordSim({ seed: 42, scenario: COLD_WARM_READ });
    const src = createSim({ seed: 42, scenario: COLD_WARM_READ });
    const first = recordSim({ source: src });
    src.reset();
    const second = recordSim({ source: src });
    expect(JSON.stringify(first)).toBe(JSON.stringify(a));
    expect(JSON.stringify(second)).toBe(JSON.stringify(a));
  });

  it('a different seed changes only timings and CPU choices', () => {
    const a = recordSim({ seed: 1, scenario: COLD_WARM_READ });
    const b = recordSim({ seed: 2, scenario: COLD_WARM_READ });
    expect({ ...a.header, seed: 0 }).toEqual({ ...b.header, seed: 0 });
    expect(a.events.map(shape)).toEqual(b.events.map(shape));
    expect(a.events.map((e) => e.ts)).not.toEqual(b.events.map((e) => e.ts));
  });

  it('seeds vary the interrupt CPU, and nothing but timings and CPUs', () => {
    const base = recordSim({ seed: 1, scenario: COLD_WARM_READ }).events.map(shape);
    const irqCpus = new Set<number>();
    for (let seed = 1; seed <= 24; seed++) {
      const r = recordSim({ seed, scenario: COLD_WARM_READ });
      expect(r.events.map(shape), `seed ${seed}`).toEqual(base);
      for (const e of r.events) if (e.type === 'irq_handler_entry') irqCpus.add(e.cpu);
    }
    expect(irqCpus.size).toBeGreaterThan(1);
  });
});
