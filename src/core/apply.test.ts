import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../test/helpers/fixture';
import { ApplyError, apply, checkInvariants, initialState } from './apply';
import { FixtureSource } from './fixtureSource';
import { Runtime } from './runtime';
import type { KEvent, KernelState } from './types';

function runFixture(): { rt: Runtime; states: KernelState[] } {
  const rt = new Runtime(new FixtureSource(loadFixture()));
  const states: KernelState[] = [];
  while (rt.step()) states.push(structuredClone(rt.state) as KernelState);
  return { rt, states };
}

describe('apply over the fixture', () => {
  it('ends with reader in user mode, the page up to date, one miss and one hit', () => {
    const { rt } = runFixture();
    const s = rt.state;
    expect(s.tasks[100]).toMatchObject({ comm: 'reader', mode: 'user', state: 'running', station: 'user' });
    expect(s.pageCache['12:0']).toBe('uptodate');
    expect(s.counters.cacheMisses).toBe(1);
    expect(s.counters.cacheHits).toBe(1);
    expect(s.counters.interrupts).toBe(1);
    expect(s.blockQueues['vda']).toEqual([]);
    expect(s.flows).toEqual({});
  });

  it('keeps the invariants after every event', () => {
    const { states } = runFixture();
    for (const s of states) expect(checkInvariants(s), `after seq ${s.seq}`).toEqual([]);
  });

  it('puts reader to sleep in D at the page cache, holding no CPU', () => {
    const { states } = runFixture();
    const asleep = states.find((s) => s.tasks[100]?.state === 'sleeping');
    expect(asleep?.tasks[100]).toMatchObject({ sleep: 'D', cpu: null, station: 'page_cache' });
    expect(asleep?.cpus[0]?.context).toBe('idle');
  });

  it('interrupt borrows cpu1 from busy-a and gives it back', () => {
    const { states } = runFixture();
    const inIrq = states.find((s) => s.cpus[1]?.context === 'hardirq');
    expect(inIrq?.cpus[1]).toMatchObject({ current: 101, interrupted: ['user'] });
    const after = states.find((s) => s.counters.softirqs === 1 && s.cpus[1]?.context === 'user');
    expect(after?.tasks[101]?.state).toBe('running');
  });

  it('moves the request, not the sleeping task, during completion', () => {
    const { states } = runFixture();
    const inSoftirq = states.find((s) => s.cpus[1]?.context === 'softirq' && s.pageCache['12:0'] === 'uptodate');
    expect(inSoftirq?.flows[1]?.station).toBe('page_cache');
    expect(inSoftirq?.tasks[101]?.station).toBe('user');
    expect(inSoftirq?.tasks[100]?.station).toBe('page_cache');
  });
});

describe('apply rejects events that do not fit', () => {
  const header = loadFixture().header;
  const base = { tier: 'T' as const, cpu: 0, pid: 100 };

  it('rejects an event whose pid is not current on its CPU', () => {
    const s = initialState(header);
    const ev: KEvent = { ...base, seq: 0, ts: 1, pid: 101, type: 'sys_enter', name: 'read', args: [] };
    expect(() => apply(s, ev)).toThrow(ApplyError);
  });

  it('rejects sys_exit in user mode', () => {
    const s = initialState(header);
    expect(() => apply(s, { ...base, seq: 0, ts: 1, type: 'sys_exit', name: 'read', ret: 0 })).toThrow(/not in kernel mode/);
  });

  it('rejects a cache hit on an absent page', () => {
    const s = initialState(header);
    apply(s, { ...base, seq: 0, ts: 1, type: 'sys_enter', name: 'read', args: [] });
    expect(() =>
      apply(s, { ...base, tier: 'P', seq: 1, ts: 2, type: 'page_cache_lookup', ino: 12, index: 0, hit: true }),
    ).toThrow(/not up to date/);
  });

  it('rejects switching to a task that is not on the runqueue', () => {
    const s = initialState(header);
    expect(() =>
      apply(s, { ...base, seq: 0, ts: 1, type: 'sched_switch', prevPid: 100, prevState: 'S', nextPid: 102 }),
    ).toThrow(/not on the runqueue/);
  });

  it('rejects time going back', () => {
    const s = initialState(header);
    apply(s, { ...base, seq: 0, ts: 10, type: 'sys_enter', name: 'read', args: [] });
    expect(() => apply(s, { ...base, seq: 1, ts: 5, type: 'sys_exit', name: 'read', ret: 0 })).toThrow(/ts goes back/);
  });
});

describe('checkInvariants', () => {
  it('reports a task on two runqueues and a sleeping task holding a CPU', () => {
    const s = initialState(loadFixture().header);
    s.cpus[3]!.runqueue.push(101);
    s.cpus[2]!.runqueue.push(101);
    s.tasks[101]!.state = 'runnable';
    s.cpus[1]!.current = 0;
    s.cpus[1]!.context = 'idle';
    s.tasks[102]!.state = 'sleeping';
    s.cpus[2]!.current = 0;
    s.cpus[2]!.context = 'idle';
    const v = checkInvariants(s);
    expect(v).toContain('pid 101 on two runqueues');
    expect(v).toContain('pid 102 sleeping but holds cpu 2');
  });
});
