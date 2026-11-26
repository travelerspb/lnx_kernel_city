// Behaviour of the synthetic model against the evidence. Step numbers refer
// to the tables in evidence/read-path.md ("Cold read, in order").

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apply, checkInvariants, initialState } from '../core/apply';
import { DEFAULT_SEED } from '../core/rng';
import { FUNCTION_STATIONS } from '../core/stations';
import type { CpuContext, KEvent, KernelState, PageState } from '../core/types';
import { validateStream } from '../core/validate';
import { createSim } from './model';
import { recordSim } from './record';
import { COLD_WARM_READ, type Scenario } from './scenarios';

const READER = COLD_WARM_READ.reader;
const PAGE = `${COLD_WARM_READ.file.ino}:0`;

interface Traced {
  ev: KEvent;
  /** CPU context and current pid of ev.cpu before the event. */
  before: { context: CpuContext; current: number };
  page: PageState | undefined;
  after: KernelState;
}

function trace(seed = DEFAULT_SEED, scenario: Scenario = COLD_WARM_READ): Traced[] {
  const src = createSim({ seed, scenario });
  const state = initialState(src.header);
  const out: Traced[] = [];
  while (src.peek() !== null) {
    const ev = src.next(state);
    const c = state.cpus[ev.cpu]!;
    const before = { context: c.context, current: c.current };
    apply(state, ev);
    out.push({ ev, before, page: state.pageCache[PAGE], after: structuredClone(state) });
  }
  return out;
}

const idx = (t: Traced[], pred: (e: KEvent) => boolean) => t.findIndex((x) => pred(x.ev));
const first = (t: Traced[], type: KEvent['type'], flow?: number) =>
  idx(t, (e) => e.type === type && (flow === undefined || e.flow === flow));
const fnEntry = (t: Traced[], fn: string) => idx(t, (e) => e.type === 'func_entry' && e.fn === fn);

describe('sim model: stream validity', () => {
  it('passes validate', () => {
    const r = recordSim({ seed: DEFAULT_SEED, scenario: COLD_WARM_READ });
    expect(validateStream(r.header, r.events)).toEqual([]);
    expect(r.header.source).toBe('sim');
    expect(r.header.seed).toBe(DEFAULT_SEED);
  });

  it('keeps the state invariants after every event, for several seeds', () => {
    for (const seed of [DEFAULT_SEED, 1, 2, 3, 99]) {
      for (const t of trace(seed)) expect(checkInvariants(t.after), `seed ${seed} seq ${t.ev.seq}`).toEqual([]);
    }
  });

  it('uses integer timestamps', () => {
    for (const t of trace()) expect(Number.isInteger(t.ev.ts)).toBe(true);
  });

  it('next() reads state and never writes it', () => {
    const src = createSim({ seed: DEFAULT_SEED, scenario: COLD_WARM_READ });
    const state = initialState(src.header);
    while (src.peek() !== null) {
      const before = JSON.stringify(state);
      const ev = src.next(state);
      expect(JSON.stringify(state)).toBe(before);
      apply(state, ev);
    }
  });

  it('next() refuses a state that has not applied its previous event', () => {
    const src = createSim({ seed: DEFAULT_SEED, scenario: COLD_WARM_READ });
    const state = initialState(src.header);
    src.next(state);
    expect(() => src.next(state)).toThrow(/state/);
  });

  it('peek() is null at the end and matches the next event before that', () => {
    const src = createSim({ seed: DEFAULT_SEED, scenario: COLD_WARM_READ });
    const state = initialState(src.header);
    while (src.peek() !== null) {
      const ts = src.peek();
      const ev = src.next(state);
      expect(ev.ts).toBe(ts);
      apply(state, ev);
    }
    expect(src.peek()).toBeNull();
  });
});

describe('sim model: evidence for every function', () => {
  const index = JSON.parse(readFileSync(resolve(__dirname, '../../evidence/index.json'), 'utf8')) as {
    functions: Record<string, unknown>;
  };

  it('every emitted fn has an evidence/index.json entry and a station', () => {
    const fns = new Set<string>();
    for (const seed of [DEFAULT_SEED, 1, 2, 3]) {
      for (const { ev } of trace(seed)) if (ev.type === 'func_entry' || ev.type === 'func_exit') fns.add(ev.fn);
    }
    expect(fns.size).toBeGreaterThan(10);
    expect([...fns].filter((f) => !index.functions[f])).toEqual([]);
    expect([...fns].filter((f) => !FUNCTION_STATIONS[f])).toEqual([]);
  });

  it('every func_entry has a matching func_exit in the same context', () => {
    const stacks = new Map<string, string[]>();
    for (const { ev, before } of trace()) {
      if (ev.type !== 'func_entry' && ev.type !== 'func_exit') continue;
      const key = before.context === 'hardirq' || before.context === 'softirq' ? `irq:${ev.cpu}` : `task:${ev.pid}`;
      const s = stacks.get(key) ?? [];
      stacks.set(key, s);
      if (ev.type === 'func_entry') s.push(ev.fn);
      else expect(s.pop(), `seq ${ev.seq}`).toBe(ev.fn);
    }
    for (const [k, s] of stacks) expect(s, k).toEqual([]);
  });
});

describe('sim model: cold read ordering (evidence/read-path.md)', () => {
  const t = trace();

  it('sys_enter opens each flow and sys_exit closes it (steps 2 and 58)', () => {
    const flows = new Set(t.map((x) => x.ev.flow).filter((f): f is number => f !== undefined));
    expect([...flows]).toEqual([1, 2]);
    for (const f of flows) {
      const evs = t.filter((x) => x.ev.flow === f).map((x) => x.ev.type);
      expect(evs[0]).toBe('sys_enter');
      expect(evs.at(-1)).toBe('sys_exit');
      expect(evs.filter((x) => x === 'sys_enter' || x === 'sys_exit')).toHaveLength(2);
    }
  });

  it('the page is locked before block_bio_queue (steps 15, 21)', () => {
    const add = first(t, 'mm_filemap_add_to_page_cache');
    const bio = first(t, 'block_bio_queue');
    expect(add).toBeGreaterThanOrEqual(0);
    expect(add).toBeLessThan(bio);
    expect(t[bio]!.page).toBe('locked');
  });

  it('the page is up to date only after block_rq_complete (steps 46, 49)', () => {
    const complete = first(t, 'block_rq_complete');
    const uptodate = t.findIndex((x) => x.page === 'uptodate');
    expect(complete).toBeGreaterThan(0);
    expect(uptodate).toBeGreaterThan(complete);
    expect(t[uptodate]!.ev.type).toBe('folio_end_read');
  });

  it('submission order: bio queue, plug flush, insert, queue_rq, issue, notify (steps 21-30)', () => {
    const order = [
      first(t, 'block_bio_queue'),
      fnEntry(t, 'blk_finish_plug'),
      first(t, 'block_rq_insert'),
      fnEntry(t, 'virtio_queue_rq'),
      first(t, 'block_rq_issue'),
      first(t, 'hw_io_start'),
    ];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('reader switches away in D after the request is issued and before hw_io_done (steps 29, 35, 36)', () => {
    const away = idx(t, (e) => e.type === 'sched_switch' && e.prevPid === READER);
    const ev = t[away]!.ev as Extract<KEvent, { type: 'sched_switch' }>;
    expect(ev.prevState).toBe('D');
    expect(away).toBeGreaterThan(first(t, 'block_rq_issue'));
    expect(away).toBeGreaterThan(first(t, 'hw_io_start'));
    expect(away).toBeLessThan(first(t, 'hw_io_done'));
    expect(t[away]!.after.tasks[READER]).toMatchObject({ state: 'sleeping', sleep: 'D', station: 'page_cache' });
  });

  it('hardirq then BLOCK softirq, in the tracepoint order of "Interrupt and softirq context" (steps 37-53)', () => {
    const order = [
      first(t, 'hw_io_done'),
      first(t, 'irq_handler_entry'),
      first(t, 'softirq_raise'),
      first(t, 'irq_handler_exit'),
      first(t, 'softirq_entry'),
      first(t, 'block_rq_complete'),
      first(t, 'folio_end_read'),
      first(t, 'sched_waking'),
      first(t, 'softirq_exit'),
    ];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const type of ['softirq_raise', 'softirq_entry', 'softirq_exit'] as const) {
      expect((t[first(t, type)]!.ev as { vec: number }).vec).toBe(4);
    }
    // The whole chain runs on one CPU: the interrupt CPU.
    const irqCpu = t[first(t, 'irq_handler_entry')]!.ev.cpu;
    for (const type of ['hw_io_start', 'hw_io_done', 'softirq_entry', 'block_rq_complete', 'folio_end_read', 'sched_waking'] as const) {
      expect(t[first(t, type)]!.ev.cpu, type).toBe(irqCpu);
    }
  });

  it('the interrupt borrows a CPU from another context and gives it back (steps 37, 42, 43, 53)', () => {
    const entry = first(t, 'irq_handler_entry');
    const cpu = t[entry]!.ev.cpu;
    const was = t[entry]!.before;
    expect(was.context === 'user' || was.context === 'kernel' || was.context === 'idle').toBe(true);
    expect(was.current).not.toBe(READER);
    const exit = idx(t, (e) => e.type === 'softirq_exit' && e.cpu === cpu);
    expect(exit).toBeGreaterThan(entry);
    const c = t[exit]!.after.cpus[cpu]!;
    expect(c.context).toBe(was.context);
    expect(c.current).toBe(was.current);
    expect(c.interrupted).toEqual([]);
    // Between entry and exit nothing switched on that CPU.
    expect(t.slice(entry, exit).some((x) => x.ev.type === 'sched_switch' && x.ev.cpu === cpu)).toBe(false);
  });

  it('sched_waking for reader comes after block_rq_complete and folio_end_read (steps 46, 49, 51)', () => {
    const waking = idx(t, (e) => e.type === 'sched_waking' && e.wakee === READER);
    expect(waking).toBeGreaterThan(first(t, 'block_rq_complete'));
    expect(waking).toBeGreaterThan(first(t, 'folio_end_read'));
    const wakeup = idx(t, (e) => e.type === 'sched_wakeup' && e.wakee === READER);
    expect(wakeup).toBeGreaterThan(waking);
  });

  it("sched_waking's targetCpu is reader's last CPU; sched_wakeup's is where reader runs next (evidence/tracepoints.md sched-waking)", () => {
    const away = t[idx(t, (e) => e.type === 'sched_switch' && e.prevPid === READER)]!.ev;
    const waking = t[first(t, 'sched_waking')]!.ev as Extract<KEvent, { type: 'sched_waking' }>;
    const wakeup = t[first(t, 'sched_wakeup')]!.ev as Extract<KEvent, { type: 'sched_wakeup' }>;
    const back = t[idx(t, (e) => e.type === 'sched_switch' && e.nextPid === READER)]!.ev;
    expect(waking.targetCpu).toBe(away.cpu);
    expect(wakeup.targetCpu).toBe(back.cpu);
    expect(idx(t, (e) => e === back)).toBeGreaterThan(idx(t, (e) => e === wakeup));
  });

  it('reader copies to user after it is switched back in (steps 54, 56)', () => {
    const back = idx(t, (e) => e.type === 'sched_switch' && e.nextPid === READER);
    const copy = first(t, 'copy_to_user', 1);
    expect(copy).toBeGreaterThan(back);
    expect(t[copy]!.ev.cpu).toBe(t[back]!.ev.cpu);
  });

  it('shows one page: one alloc, one insert, one folio_end_read (readahead of pages 1-3 skipped)', () => {
    for (const type of ['mm_page_alloc', 'mm_filemap_add_to_page_cache', 'folio_end_read', 'block_bio_queue'] as const) {
      expect(t.filter((x) => x.ev.type === type), type).toHaveLength(1);
    }
  });
});

describe('sim model: warm read', () => {
  const t = trace();
  const enter = first(t, 'sys_enter', 2);
  const exit = first(t, 'sys_exit', 2);
  const QUIET = new Set([
    'block_bio_queue', 'block_rq_insert', 'block_rq_issue', 'block_rq_complete', 'hw_io_start', 'hw_io_done',
    'irq_handler_entry', 'irq_handler_exit', 'softirq_raise', 'softirq_entry', 'softirq_exit',
    'sched_waking', 'sched_wakeup', 'sched_switch', 'mm_page_alloc', 'mm_filemap_add_to_page_cache', 'folio_end_read',
  ]);

  it('is pread64 at offset 0 (read-path.md "Warm read, in order")', () => {
    const ev = t[enter]!.ev as Extract<KEvent, { type: 'sys_enter' }>;
    expect(ev.name).toBe('pread64');
    expect(ev.args[3]).toBe(0);
  });

  it('hits the page cache and emits no block, IRQ or scheduler events', () => {
    const window = t.slice(enter, exit + 1).map((x) => x.ev);
    expect(window.filter((e) => QUIET.has(e.type))).toEqual([]);
    expect(window.every((e) => e.flow === 2)).toBe(true);
    const lookup = window.find((e) => e.type === 'page_cache_lookup');
    expect(lookup).toMatchObject({ hit: true, index: 0 });
  });

  it('starts only after the cold read returned', () => {
    expect(enter).toBeGreaterThan(first(t, 'sys_exit', 1));
  });
});

describe('sim model: final state', () => {
  it('reader in user mode, page up to date, 1 miss and 1 hit, queues empty', () => {
    const r = recordSim({ seed: DEFAULT_SEED, scenario: COLD_WARM_READ });
    const state = initialState(r.header);
    for (const ev of r.events) apply(state, ev);
    expect(state.tasks[READER]).toMatchObject({ comm: 'reader', mode: 'user', state: 'running', station: 'user' });
    expect(state.pageCache[PAGE]).toBe('uptodate');
    expect(state.counters.cacheMisses).toBe(1);
    expect(state.counters.cacheHits).toBe(1);
    expect(state.counters.interrupts).toBe(1);
    expect(state.counters.softirqs).toBe(1);
    expect(state.counters.bytesCopied).toBe(8192);
    expect(state.blockQueues['vda']).toEqual([]);
    expect(state.flows).toEqual({});
  });
});

describe('sim model: wakeup placement rule', () => {
  it('prefers reader\'s previous CPU when it is idle', () => {
    const t = trace();
    const back = t[idx(t, (e) => e.type === 'sched_switch' && e.nextPid === READER)]!.ev;
    expect(back.cpu).toBe(0);
    expect(back).toMatchObject({ prevPid: 0, prevState: 'R' });
  });

  it('wakes on the previous CPU via the wake list when it is remote and idle (read-path.md "Interrupt CPU and wakeup CPU")', () => {
    const t = trace();
    const wakeup = t[first(t, 'sched_wakeup')]!.ev;
    expect(wakeup.cpu).toBe(0);
    expect(wakeup.pid).toBe(0);
  });

  it('picks another idle CPU when the previous one is busy', () => {
    // busy-c is queued on cpu 0 behind reader, so cpu 0 runs it once reader sleeps.
    const sc: Scenario = {
      ...COLD_WARM_READ,
      tasks: [
        ...COLD_WARM_READ.tasks,
        { pid: 103, comm: 'busy-c', kind: 'user', mode: 'user', state: 'runnable', cpu: 0 },
      ],
      irqCpuCandidates: [1],
    };
    const t = trace(DEFAULT_SEED, sc);
    for (const x of t) expect(checkInvariants(x.after)).toEqual([]);
    const away = t[idx(t, (e) => e.type === 'sched_switch' && e.prevPid === READER)]!.ev;
    expect(away).toMatchObject({ cpu: 0, nextPid: 103 });
    const back = t[idx(t, (e) => e.type === 'sched_switch' && e.nextPid === READER)]!.ev;
    expect(back.cpu).toBe(3);
  });

  it('falls back to the previous CPU and preempts when no CPU is idle', () => {
    const sc: Scenario = {
      ...COLD_WARM_READ,
      tasks: [
        ...COLD_WARM_READ.tasks,
        { pid: 103, comm: 'busy-c', kind: 'user', mode: 'user', state: 'runnable', cpu: 0 },
        { pid: 104, comm: 'busy-d', kind: 'user', mode: 'user', state: 'running', cpu: 3 },
      ],
      irqCpuCandidates: [2],
    };
    const t = trace(DEFAULT_SEED, sc);
    for (const x of t) expect(checkInvariants(x.after)).toEqual([]);
    const wakeup = t[first(t, 'sched_wakeup')]!.ev as Extract<KEvent, { type: 'sched_wakeup' }>;
    expect(wakeup).toMatchObject({ cpu: 2, targetCpu: 0 });
    const back = t[idx(t, (e) => e.type === 'sched_switch' && e.nextPid === READER)]!.ev;
    expect(back).toMatchObject({ cpu: 0, prevPid: 103, prevState: 'R' });
    expect(t.at(-1)!.after.tasks[READER]).toMatchObject({ mode: 'user', state: 'running' });
  });

  it('wakes locally and switches in after softirq_exit when the interrupt CPU is the idle one chosen', () => {
    const sc: Scenario = {
      ...COLD_WARM_READ,
      tasks: [
        ...COLD_WARM_READ.tasks,
        { pid: 103, comm: 'busy-c', kind: 'user', mode: 'user', state: 'runnable', cpu: 0 },
      ],
      irqCpuCandidates: [3],
    };
    const t = trace(DEFAULT_SEED, sc);
    const wakeup = first(t, 'sched_wakeup');
    const sx = first(t, 'softirq_exit');
    const back = idx(t, (e) => e.type === 'sched_switch' && e.nextPid === READER);
    expect(t[wakeup]!.ev).toMatchObject({ cpu: 3, targetCpu: 3 });
    expect(wakeup).toBeLessThan(sx);
    expect(back).toBeGreaterThan(sx);
    expect(t[back]!.ev.cpu).toBe(3);
  });
});

describe('request work while its task sleeps', () => {
  const t = trace();
  const flowAt = (x: Traced) => x.after.flows[1]?.station;
  const seqOf = (type: KEvent['type']) => t.findIndex((x) => x.ev.type === type && x.ev.flow === 1);

  it('stays at the device from hw_io_start to hw_io_done', () => {
    for (let i = seqOf('hw_io_start'); i < seqOf('hw_io_done'); i++) expect(flowAt(t[i]!)).toBe('device:vda');
  });

  it('waits at the page cache from folio_end_read until reader runs again', () => {
    const back = t.findIndex((x) => x.ev.type === 'sched_switch' && x.ev.nextPid === READER);
    for (let i = seqOf('folio_end_read'); i <= back; i++) expect(flowAt(t[i]!)).toBe('page_cache');
    expect(t[back]!.after.flows[1]?.detached).toBe(false);
  });
});

describe('scenario checks', () => {
  const sc = COLD_WARM_READ;
  it('rejects a read that spans two pages', () => {
    const read = sc.script[0]!;
    const script = [{ ...read, count: 100 }, read];
    expect(() => createSim({ scenario: { ...sc, script } })).toThrow(/span two pages/);
  });

  it('rejects a runnable task on a CPU that runs nothing', () => {
    const tasks = [...sc.tasks, { pid: 103, comm: 'q', kind: 'user' as const, mode: 'user' as const, state: 'runnable' as const, cpu: 3 }];
    expect(() => createSim({ scenario: { ...sc, tasks } })).toThrow(/runs nothing/);
  });
});
