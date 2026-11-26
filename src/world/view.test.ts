import { describe, expect, it } from 'vitest';
import { Bus } from '../core/bus';
import { FixtureSource, type EventFile } from '../core/fixtureSource';
import { Runtime } from '../core/runtime';
import { allStations } from '../core/stations';
import type { KEvent, KernelState, StationId } from '../core/types';
import { loadFixture } from '../../test/helpers/fixture';
import { DISTRICTS, MAP_BOUNDS, ZONES, inside, stationPoint } from './layout';
import { viewOf, type WorldView } from './view';

function runCollect(file: EventFile): { ev: KEvent; view: WorldView; state: KernelState }[] {
  const rt = new Runtime(new FixtureSource(file));
  const out: { ev: KEvent; view: WorldView; state: KernelState }[] = [];
  for (let ev = rt.step(); ev; ev = rt.step()) {
    out.push({ ev, view: viewOf(rt.state), state: structuredClone(rt.state) as KernelState });
  }
  return out;
}

type Frames = ReturnType<typeof runCollect>;
/** The frame right after the first event matching `pred` (after `from`). */
const after = (frames: Frames, pred: (e: KEvent) => boolean, from = -1) => {
  const f = frames.find((x) => x.ev.seq > from && pred(x.ev));
  if (!f) throw new Error('no such event');
  return f;
};
const ofType = (t: KEvent['type'], extra: (e: KEvent) => boolean = () => true) => (e: KEvent) => e.type === t && extra(e);
const task = (v: WorldView, pid: number) => v.tasks.find((t) => t.pid === pid)!;
const token = (v: WorldView, cpu: number) => v.tokens.find((t) => t.cpu === cpu)!;

describe('viewOf on the cold-warm-read fixture', () => {
  const file = loadFixture();
  const frames = runCollect(file);
  const READER = 100;
  const BUSY_A = 101;

  it('the task itself crosses the gate and changes look (rule 1)', () => {
    const init = viewOf(new Runtime(new FixtureSource(file)).state);
    expect(task(init, READER).look).toBe('task.user');
    expect(inside(ZONES.userland, task(init, READER).at)).toBe(true);
    const gate = task(after(frames, ofType('sys_enter')).view, READER);
    expect(gate.station).toBe('syscall_gate');
    expect(gate.look).toBe('task.kernel');
    const fv = after(frames, ofType('func_entry', (e) => e.type === 'func_entry' && e.fn === 'vfs_read'));
    const vfs = task(fv.view, READER);
    expect(inside(ZONES.kernel, vfs.at)).toBe(true);
    expect(fv.view.flows[0]?.carried).toBe(true);
  });

  it('the token rides on the running task', () => {
    const v = after(frames, ofType('page_cache_lookup')).view;
    const k = token(v, 0);
    expect(k.place).toBe('task');
    expect(k.carrying).toBe(READER);
    expect(k.look).toBe('cpu.kernel');
  });

  it('cargo moves to the device while the task stays (rule 4)', () => {
    const v14 = after(frames, ofType('hw_io_start')).view;
    expect(v14.flows[0]?.station).toBe('device:vda');
    expect(v14.flows[0]?.carried).toBe(false);
    expect(task(v14, READER).station).toBe('driver:virtio_blk');
    expect(v14.requests[0]?.station).toBe('device:vda');
  });

  it('the sleeping task has no token and stands still (rule 2)', () => {
    const sw = after(frames, ofType('sched_switch', (e) => e.type === 'sched_switch' && e.prevPid === READER));
    const v16 = sw.view;
    const r = task(v16, READER);
    expect(r.state).toBe('sleeping');
    expect(r.hasCpu).toBe(false);
    expect(r.look).toBe('task.kernel.sleeping');
    expect(token(v16, 0).place).toBe('lane');
    expect(token(v16, 0).look).toBe('cpu.idle');
    // From the switch-out to the wakeup the reader never moves.
    const back = after(frames, ofType('sched_switch', (e) => e.type === 'sched_switch' && e.nextPid === READER));
    for (const f of frames.filter((x) => x.ev.seq >= sw.ev.seq && x.ev.seq < back.ev.seq)) {
      expect(task(f.view, READER).at).toEqual(r.at);
      expect(task(f.view, READER).hasCpu).toBe(false);
    }
  });

  it('the interrupt borrows the CPU of another task (rule 3)', () => {
    const v18 = after(frames, ofType('irq_handler_entry')).view;
    expect(token(v18, 1).place).toBe('irq');
    expect(token(v18, 1).look).toBe('cpu.hardirq');
    const a = task(v18, BUSY_A);
    expect(a.interrupted).toBe(true);
    expect(a.hasCpu).toBe(false);
    expect(a.look).toBe('task.user.interrupted');
    expect(v18.flows[0]?.station).toBe('irq');
    const v23 = after(frames, ofType('softirq_entry')).view;
    expect(token(v23, 1).place).toBe('softirq');
    expect(token(v23, 1).look).toBe('cpu.softirq');
    const v29 = after(frames, ofType('softirq_exit')).view;
    expect(token(v29, 1).place).toBe('task');
    expect(token(v29, 1).carrying).toBe(BUSY_A);
  });

  it('pages go absent, locked, up to date', () => {
    const page = (v: WorldView) => v.pages.find((p) => p.ino === 12 && p.index === 0)!;
    const miss = after(frames, ofType('page_cache_lookup')).view;
    expect(page(miss).look).toBe('page.absent');
    expect(page(after(frames, ofType('mm_filemap_add_to_page_cache')).view).look).toBe('page.locked');
    expect(page(after(frames, ofType('folio_end_read')).view).look).toBe('page.uptodate');
    expect(miss.pages).toHaveLength(4);
  });

  it('wakeup puts the reader on the runqueue, the switch gives it the token', () => {
    const v28 = after(frames, ofType('sched_wakeup')).view;
    expect(task(v28, READER).look).toBe('task.kernel.runnable');
    expect(v28.queues).toEqual([expect.objectContaining({ cpu: 0, pid: READER, slot: 0 })]);
    const v30 = after(frames, ofType('sched_switch', (e) => e.type === 'sched_switch' && e.nextPid === READER)).view;
    expect(task(v30, READER).hasCpu).toBe(true);
    expect(token(v30, 0).carrying).toBe(READER);
    expect(v30.queues).toEqual([]);
    expect(v30.flows[0]?.carried).toBe(true);
  });

  it('the warm read keeps its cargo north of the block depot', () => {
    const firstExit = after(frames, ofType('sys_exit'));
    const warm = frames.filter((f) => f.ev.seq > firstExit.ev.seq);
    expect(warm.length).toBeGreaterThan(0);
    const allowed = new Set<StationId>(['syscall_gate', 'vfs', 'fs:ext4', 'page_cache', 'user']);
    for (const f of warm) {
      for (const fl of f.view.flows) expect(allowed.has(fl.station)).toBe(true);
      expect(f.view.requests).toEqual([]);
      expect(task(f.view, READER).hasCpu).toBe(true);
    }
  });

  it('every entity stays on the map', () => {
    for (const { view } of frames) {
      const pts = [
        ...view.tasks.map((t) => t.at), ...view.tokens.map((t) => t.at), ...view.flows.map((t) => t.at),
        ...view.requests.map((t) => t.at), ...view.pages.map((t) => t.at), ...view.queues.map((t) => t.at),
      ];
      for (const p of pts) expect(inside(MAP_BOUNDS, p)).toBe(true);
    }
  });

  it('renders without tier S events', () => {
    const noS: EventFile = { header: file.header, events: file.events.filter((e) => e.tier !== 'S') };
    // seq must stay strictly increasing, which filtering keeps.
    const f2 = runCollect(noS);
    expect(f2.length).toBe(noS.events.length);
    expect(f2.at(-1)!.view.tasks.every((t) => t.look === 'task.user')).toBe(true);
  });

  it('reset gives the initial view again', () => {
    const bus = new Bus();
    const rt = new Runtime(new FixtureSource(file), bus);
    const v0 = viewOf(rt.state);
    rt.runToEnd();
    expect(viewOf(rt.state)).not.toEqual(v0);
    rt.reset();
    expect(viewOf(rt.state)).toEqual(v0);
  });
});

describe('layout', () => {
  it('has a point for every Stage 1 station, inside the map', () => {
    for (const s of allStations(4)) expect(inside(MAP_BOUNDS, stationPoint(s))).toBe(true);
  });

  it('kernel stations are south of the gate, user is north', () => {
    expect(stationPoint('user').z).toBeLessThan(ZONES.gate.minZ);
    for (const s of ['vfs', 'fs:ext4', 'page_cache', 'block', 'irq', 'softirq', 'driver:virtio_blk'] as StationId[]) {
      expect(stationPoint(s).z).toBeGreaterThan(ZONES.gate.maxZ);
    }
  });

  it('district stations sit in their districts', () => {
    expect(inside(DISTRICTS.vfs, stationPoint('vfs'))).toBe(true);
    expect(inside(DISTRICTS.page_cache, stationPoint('page_cache'))).toBe(true);
    expect(inside(DISTRICTS.block, stationPoint('block'))).toBe(true);
    expect(inside(DISTRICTS.drivers, stationPoint('driver:virtio_blk'))).toBe(true);
    expect(inside(DISTRICTS.interrupts, stationPoint('irq'))).toBe(true);
    expect(inside(DISTRICTS.scheduler, stationPoint('runqueue:3'))).toBe(true);
    expect(inside(ZONES.hardware, stationPoint('device:vda'))).toBe(true);
  });
});

describe('kernel threads stay south of the gate (rule 5)', () => {
  it('a kthread whose station is on the user side is drawn in the kernel city', () => {
    const file = loadFixture();
    const rt = new Runtime(new FixtureSource(file));
    const s = structuredClone(rt.state) as KernelState;
    s.tasks[7] = {
      pid: 7, comm: 'kworker/0:1', kind: 'kthread', mode: 'kernel', state: 'sleeping',
      sleep: 'S', waking: false, cpu: null, station: 'syscall_gate',
    };
    s.tasks[8] = { ...s.tasks[7]!, pid: 8, station: 'user' };
    const v = viewOf(s);
    for (const pid of [7, 8]) {
      const t = v.tasks.find((x) => x.pid === pid)!;
      expect(t.at.z).toBeGreaterThan(ZONES.gate.maxZ);
      expect(inside(ZONES.kernel, t.at)).toBe(true);
    }
  });
});
