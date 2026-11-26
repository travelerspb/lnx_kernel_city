import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../test/helpers/fixture';
import { FixtureSource } from '../core/fixtureSource';
import { Runtime } from '../core/runtime';
import type { KEvent } from '../core/types';
import { describeEvent, formatNs, formatNsExact, softirqName, taskName } from './format';

describe('formatNs', () => {
  it('picks ns, µs, ms, s', () => {
    expect(formatNs(0)).toBe('0 ns');
    expect(formatNs(999)).toBe('999 ns');
    expect(formatNs(1000)).toBe('1.000 µs');
    expect(formatNs(1500)).toBe('1.500 µs');
    expect(formatNs(999_999)).toBe('999.999 µs');
    expect(formatNs(2_000_000)).toBe('2.000 ms');
    expect(formatNs(180_000_000)).toBe('180.000 ms');
    expect(formatNs(3_250_000_000)).toBe('3.250 s');
  });

  it('handles negatives and non-finite values', () => {
    expect(formatNs(-1500)).toBe('-1.500 µs');
    expect(formatNs(Number.NaN)).toBe('—');
  });

  it('formats exact ns with digit groups', () => {
    expect(formatNsExact(0)).toBe('0 ns');
    expect(formatNsExact(999)).toBe('999 ns');
    expect(formatNsExact(1234567)).toBe('1 234 567 ns');
  });
});

describe('describeEvent', () => {
  const rt = new Runtime(new FixtureSource(loadFixture()));
  const state = rt.state;
  const base = { seq: 0, ts: 0, cpu: 0, pid: 100, tier: 'T' } as const;

  it('names tasks, the idle task and unknown pids', () => {
    expect(taskName(state, 100)).toBe('reader(100)');
    expect(taskName(state, 0, 3)).toBe('swapper/3(0)');
    expect(taskName(state, 999)).toBe('pid 999');
    expect(taskName(null, 100)).toBe('pid 100');
  });

  it('writes one line per event type', () => {
    const cases: Array<[KEvent, string]> = [
      [{ ...base, type: 'sys_enter', name: 'read', args: [3, 4096, 4096] }, 'read(3, 4096, 4096)'],
      [{ ...base, type: 'sys_exit', name: 'read', ret: 4096 }, 'read = 4096'],
      [{ ...base, tier: 'P', type: 'func_entry', fn: 'vfs_read' }, '→ vfs_read'],
      [{ ...base, tier: 'P', type: 'func_exit', fn: 'vfs_read', ret: 0 }, '← vfs_read = 0'],
      [{ ...base, tier: 'P', type: 'page_cache_lookup', ino: 12, index: 0, hit: false }, 'ino 12 page 0: miss'],
      [{ ...base, type: 'block_rq_complete', dev: 'vda', sector: 2048, nrSectors: 8, error: 0 }, 'vda sector 2048 + 8'],
      [{ ...base, type: 'softirq_raise', vec: 4 }, 'BLOCK'],
      [{ ...base, type: 'sched_switch', prevPid: 100, prevState: 'D', nextPid: 0 }, 'reader(100) [D] → swapper/0(0)'],
      [{ ...base, type: 'sched_waking', wakee: 100, targetCpu: 0 }, 'reader(100) on cpu 0'],
      [{ ...base, tier: 'P', type: 'copy_to_user', bytes: 4096 }, '4096 bytes'],
    ];
    for (const [ev, text] of cases) expect(describeEvent(ev, state)).toBe(text);
  });

  it('describes every fixture event without throwing', () => {
    for (const ev of loadFixture().events) expect(describeEvent(ev, state).length).toBeGreaterThan(0);
  });

  it('knows softirq vector names', () => {
    expect(softirqName(4)).toBe('BLOCK');
    expect(softirqName(42)).toBe('vec 42');
  });
});
