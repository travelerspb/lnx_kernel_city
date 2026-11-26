// The reducer. The only code that writes KernelState (ARCHITECTURE.md, rule 1).
// It is deterministic: no clocks, no randomness.

import { stationOfFunction } from './stations';
import type {
  CpuState,
  KEvent,
  KernelState,
  StreamHeader,
  TaskState,
} from './types';

export class ApplyError extends Error {
  constructor(
    readonly event: KEvent,
    message: string,
  ) {
    super(`seq ${event.seq} ${event.type}: ${message}`);
    this.name = 'ApplyError';
  }
}

export function pageKey(ino: number, index: number): string {
  return `${ino}:${index}`;
}

/** Build the state at ts = 0 from a stream header. */
export function initialState(header: StreamHeader): KernelState {
  const snap = header.snapshot;
  const tasks: Record<number, TaskState> = {};
  for (const t of snap.tasks) {
    tasks[t.pid] = {
      pid: t.pid,
      comm: t.comm,
      kind: t.kind,
      mode: t.mode,
      state: t.state,
      sleep: t.state === 'sleeping' ? 'S' : null,
      waking: false,
      cpu: t.cpu,
      station: t.mode === 'user' ? 'user' : 'vfs',
    };
  }
  const cpus: CpuState[] = [];
  for (let id = 0; id < header.ncpu; id++) {
    const c = snap.cpus.find((x) => x.id === id);
    const current = c?.current ?? 0;
    cpus.push({
      id,
      current,
      context: contextOfTask(current === 0 ? undefined : tasks[current]),
      interrupted: [],
      runqueue: c ? [...c.runqueue] : [],
    });
  }
  const pageCache: Record<string, KernelState['pageCache'][string]> = {};
  for (const p of snap.pageCache) {
    if (p.state !== 'absent') pageCache[pageKey(p.ino, p.index)] = p.state;
  }
  const blockQueues: KernelState['blockQueues'] = {};
  for (const d of snap.devices) blockQueues[d.dev] = [];
  return {
    now: 0,
    seq: -1,
    header,
    cpus,
    tasks,
    pageCache,
    blockQueues,
    flows: {},
    counters: {
      events: 0,
      contextSwitches: 0,
      cacheHits: 0,
      cacheMisses: 0,
      pagesAllocated: 0,
      interrupts: 0,
      softirqs: 0,
      bytesCopied: 0,
    },
  };
}

function contextOfTask(t: TaskState | undefined): CpuState['context'] {
  if (!t) return 'idle';
  return t.mode === 'user' ? 'user' : 'kernel';
}

/** Apply one event in place. Throws ApplyError if the event does not fit the
 *  current state, so that a wrong model or a broken trace fails loudly. */
export function apply(state: KernelState, ev: KEvent): void {
  const fail = (msg: string): never => {
    throw new ApplyError(ev, msg);
  };
  if (ev.seq <= state.seq) fail(`seq not increasing (last ${state.seq})`);
  if (ev.ts < state.now) fail(`ts goes back (now ${state.now})`);
  const cpu = state.cpus[ev.cpu] ?? fail(`no cpu ${ev.cpu}`);
  // Tier S hardware events happen off-CPU; for them `pid` is informational.
  if (ev.tier !== 'S' && cpu.current !== ev.pid) {
    fail(`pid ${ev.pid} is not current on cpu ${ev.cpu} (current ${cpu.current})`);
  }
  const inTaskContext = cpu.context === 'user' || cpu.context === 'kernel';
  const current = state.tasks[ev.pid];

  const req = (dev: string, sector: number) => {
    const q = state.blockQueues[dev] ?? fail(`no device ${dev}`);
    const r = q.find((x) => x.sector === sector) ?? fail(`no request at sector ${sector} on ${dev}`);
    return r;
  };
  const moveFlow = (station: TaskState['station']) => {
    if (ev.flow === undefined) return;
    const f = state.flows[ev.flow];
    if (f) f.station = station;
  };
  // A function or tracepoint in process context moves the task itself, and
  // the request's work with it until the driver hands the request to the
  // device. In interrupt context it moves the request's work, never the
  // interrupted task; a return there only unwinds, so the work stays put.
  const moveHere = (station: TaskState['station'], unwinding = false) => {
    if (inTaskContext) {
      if (current) current.station = station;
      const f = ev.flow === undefined ? undefined : state.flows[ev.flow];
      if (!f?.detached) moveFlow(station);
    } else if (!unwinding) {
      moveFlow(station);
    }
  };

  switch (ev.type) {
    case 'sys_enter': {
      if (!current) fail('idle task cannot make a syscall');
      const t = current!;
      if (cpu.context !== 'user' || t.mode !== 'user') fail('sys_enter while not in user mode');
      t.mode = 'kernel';
      t.station = 'syscall_gate';
      cpu.context = 'kernel';
      if (ev.flow !== undefined) {
        if (state.flows[ev.flow]) fail(`flow ${ev.flow} already open`);
        state.flows[ev.flow] = {
          id: ev.flow,
          kind: 'syscall',
          name: ev.name,
          pid: t.pid,
          station: 'syscall_gate',
          detached: false,
          startedAt: ev.ts,
        };
      }
      break;
    }
    case 'sys_exit': {
      if (!current) fail('idle task cannot return from a syscall');
      const t = current!;
      if (cpu.context !== 'kernel' || t.mode !== 'kernel') fail('sys_exit while not in kernel mode');
      t.mode = 'user';
      t.station = 'user';
      cpu.context = 'user';
      if (ev.flow !== undefined) delete state.flows[ev.flow];
      break;
    }
    case 'func_entry':
    case 'func_exit': {
      if (cpu.context === 'user') fail('kernel function in user mode');
      const st = stationOfFunction(ev.fn);
      if (st) moveHere(st, ev.type === 'func_exit');
      break;
    }
    case 'page_cache_lookup': {
      if (ev.hit) state.counters.cacheHits++;
      else state.counters.cacheMisses++;
      const have = state.pageCache[pageKey(ev.ino, ev.index)];
      if (ev.hit && have !== 'uptodate') fail('hit on a page that is not up to date');
      if (!ev.hit && have !== undefined) fail('miss on a page that is in the cache');
      moveHere('page_cache');
      break;
    }
    case 'mm_page_alloc':
      state.counters.pagesAllocated += 2 ** ev.order;
      break;
    case 'mm_filemap_add_to_page_cache': {
      const k = pageKey(ev.ino, ev.index);
      if (state.pageCache[k] !== undefined) fail('page already in cache');
      // A folio is added to the cache locked; read completion unlocks it.
      state.pageCache[k] = 'locked';
      moveHere('page_cache');
      break;
    }
    case 'folio_end_read': {
      const k = pageKey(ev.ino, ev.index);
      if (state.pageCache[k] !== 'locked') fail('folio_end_read on a page that is not locked');
      if (ev.ok) state.pageCache[k] = 'uptodate';
      else delete state.pageCache[k];
      moveHere('page_cache');
      break;
    }
    case 'block_bio_queue': {
      const q = state.blockQueues[ev.dev] ?? fail(`no device ${ev.dev}`);
      if (q.some((x) => x.sector === ev.sector)) fail('request at this sector already queued');
      q.push({ dev: ev.dev, sector: ev.sector, nrSectors: ev.nrSectors, stage: 'queued', flow: ev.flow ?? null });
      moveHere('block');
      break;
    }
    case 'block_rq_insert':
      req(ev.dev, ev.sector).stage = 'inserted';
      moveHere('block');
      break;
    case 'block_rq_issue':
      req(ev.dev, ev.sector).stage = 'issued';
      moveHere('driver:virtio_blk');
      if (ev.flow !== undefined && state.flows[ev.flow]) state.flows[ev.flow]!.detached = true;
      break;
    case 'hw_io_start': {
      const r = req(ev.dev, ev.sector);
      if (r.stage !== 'issued') fail('device started a request that was not issued');
      r.stage = 'in_device';
      moveFlow(`device:${ev.dev}` as TaskState['station']);
      break;
    }
    case 'hw_io_done': {
      const r = req(ev.dev, ev.sector);
      if (r.stage !== 'in_device') fail('device finished a request it was not working on');
      r.stage = 'device_done';
      moveFlow(`device:${ev.dev}` as TaskState['station']);
      break;
    }
    case 'block_rq_complete': {
      const q = state.blockQueues[ev.dev] ?? fail(`no device ${ev.dev}`);
      const i = q.findIndex((x) => x.sector === ev.sector);
      if (i < 0) fail(`no request at sector ${ev.sector}`);
      q.splice(i, 1);
      moveHere('block');
      break;
    }
    case 'irq_handler_entry':
      cpu.interrupted.push(cpu.context);
      cpu.context = 'hardirq';
      state.counters.interrupts++;
      moveFlow('irq');
      break;
    case 'irq_handler_exit':
      if (cpu.context !== 'hardirq') fail('irq_handler_exit outside hardirq');
      cpu.context = cpu.interrupted.pop() ?? fail('interrupt stack empty');
      break;
    case 'softirq_raise':
      break;
    case 'softirq_entry':
      if (cpu.context === 'hardirq') fail('softirq_entry inside hardirq');
      cpu.interrupted.push(cpu.context);
      cpu.context = 'softirq';
      state.counters.softirqs++;
      moveFlow('softirq');
      break;
    case 'softirq_exit':
      if (cpu.context !== 'softirq') fail('softirq_exit outside softirq');
      cpu.context = cpu.interrupted.pop() ?? fail('interrupt stack empty');
      break;
    case 'sched_waking': {
      const w = state.tasks[ev.wakee] ?? fail(`no task ${ev.wakee}`);
      if (w.state !== 'sleeping') fail('waking a task that is not sleeping');
      w.waking = true;
      break;
    }
    case 'sched_wakeup': {
      const w = state.tasks[ev.wakee] ?? fail(`no task ${ev.wakee}`);
      if (w.state !== 'sleeping') fail('wakeup of a task that is not sleeping');
      const target = state.cpus[ev.targetCpu] ?? fail(`no cpu ${ev.targetCpu}`);
      w.state = 'runnable';
      w.sleep = null;
      w.waking = false;
      w.cpu = target.id;
      target.runqueue.push(w.pid);
      break;
    }
    case 'sched_switch': {
      if (!inTaskContext && cpu.context !== 'idle') fail(`sched_switch in ${cpu.context} context`);
      if (ev.prevPid !== cpu.current) fail(`prev ${ev.prevPid} is not current`);
      if (ev.prevPid !== 0) {
        const p = state.tasks[ev.prevPid] ?? fail(`no task ${ev.prevPid}`);
        if (ev.prevState === 'R') {
          p.state = 'runnable';
          p.cpu = cpu.id;
          cpu.runqueue.push(p.pid);
        } else {
          p.state = 'sleeping';
          p.sleep = ev.prevState;
          p.cpu = null;
        }
      }
      if (ev.nextPid !== 0) {
        const n = state.tasks[ev.nextPid] ?? fail(`no task ${ev.nextPid}`);
        const i = cpu.runqueue.indexOf(n.pid);
        if (n.state !== 'runnable' || i < 0) fail(`next ${n.pid} is not on the runqueue of cpu ${cpu.id}`);
        cpu.runqueue.splice(i, 1);
        n.state = 'running';
        n.cpu = cpu.id;
        // The task picks its request's work up again where it waits.
        for (const f of Object.values(state.flows)) {
          if (f.pid === n.pid && f.detached) {
            f.detached = false;
            f.station = n.station;
          }
        }
      }
      cpu.current = ev.nextPid;
      cpu.context = contextOfTask(ev.nextPid === 0 ? undefined : state.tasks[ev.nextPid]);
      state.counters.contextSwitches++;
      break;
    }
    case 'copy_to_user':
      if (cpu.context !== 'kernel') fail('copy_to_user outside process context');
      state.counters.bytesCopied += ev.bytes;
      moveHere('syscall_gate');
      break;
    default: {
      const never: never = ev;
      fail(`unknown event type ${(never as KEvent).type}`);
    }
  }
  state.now = ev.ts;
  state.seq = ev.seq;
  state.counters.events++;
}

/** Invariants that must hold after every event. Returns a list of
 *  violations; empty means the state is consistent. */
export function checkInvariants(state: KernelState): string[] {
  const out: string[] = [];
  const currentOf = new Map<number, number>();
  for (const c of state.cpus) {
    if (c.current !== 0) {
      if (currentOf.has(c.current)) out.push(`pid ${c.current} current on two CPUs`);
      currentOf.set(c.current, c.id);
    }
  }
  const queuedOn = new Map<number, number>();
  for (const c of state.cpus) {
    for (const pid of c.runqueue) {
      if (queuedOn.has(pid)) out.push(`pid ${pid} on two runqueues`);
      queuedOn.set(pid, c.id);
    }
  }
  for (const t of Object.values(state.tasks)) {
    const runningOn = currentOf.get(t.pid);
    const queued = queuedOn.get(t.pid);
    if (t.state === 'running' && (runningOn === undefined || runningOn !== t.cpu)) {
      out.push(`pid ${t.pid} running but not current on its CPU`);
    }
    if (t.state !== 'running' && runningOn !== undefined) out.push(`pid ${t.pid} is current but ${t.state}`);
    if (t.state === 'runnable' && (queued === undefined || queued !== t.cpu)) {
      out.push(`pid ${t.pid} runnable but not on its CPU's runqueue`);
    }
    if (t.state !== 'runnable' && queued !== undefined) out.push(`pid ${t.pid} on a runqueue but ${t.state}`);
    if (t.state === 'sleeping' && t.cpu !== null) out.push(`pid ${t.pid} sleeping but holds cpu ${t.cpu}`);
    if (t.kind === 'kthread' && t.mode === 'user') out.push(`kthread ${t.pid} in user mode`);
  }
  for (const c of state.cpus) {
    if (c.current === 0 && c.interrupted.length === 0 && c.context !== 'idle') {
      out.push(`cpu ${c.id} runs idle but context is ${c.context}`);
    }
  }
  return out;
}
