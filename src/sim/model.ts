// The synthetic kernel model: a deterministic discrete-event simulation that
// implements EventSource (ARCHITECTURE.md, data flow).
//
// Structure. The model keeps a private agenda of processes. A process is a
// list of steps; each step happens `dt` ns after the previous one, on a given
// CPU, and produces exactly one event. Steps build their event lazily, when
// next(state) reaches them, so that decisions (page cache hit or miss, which
// task runs next, where a woken task goes) read KernelState as it is at that
// moment. A step may spawn new processes or insert steps into its own.
// The agenda is ordered by timestamp, ties broken by insertion order, so the
// stream is fully determined by the seed and the scenario.
//
// The model never writes KernelState. Its private bookkeeping (file
// positions, the reader's last CPU, the chosen interrupt CPU) is scheduling
// state that the kernel would also keep but that Stage 1 does not draw.
//
// Step order follows evidence/read-path.md (kernel v6.18, single-queue
// virtio_blk, mq-deadline). Step numbers in comments refer to its tables.
// Scheduler: per-CPU runqueues live in KernelState; a task runs until it
// sleeps or the scenario ends; no timer tick (docs/stage-1/WP2-sim-model.md).

import { pageKey } from '../core/apply';
import { DEFAULT_SEED, createRng, type Rng } from '../core/rng';
import {
  SOFTIRQ,
  type EventSource,
  type KEvent,
  type KernelState,
  type SnapshotCpu,
  type StreamHeader,
} from '../core/types';
import { COSTS, deviceLatency } from './costs';
import { COLD_WARM_READ, type Scenario, type ScenarioAction } from './scenarios';

const PAGE_SIZE = 4096;
const SECTORS_PER_PAGE = PAGE_SIZE / 512;

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An event without the envelope fields the agenda fills in. */
export type EventBody = DistOmit<KEvent, 'seq' | 'ts' | 'cpu' | 'pid'>;

interface StepCtx {
  /** Timestamp of the event being built. */
  now: number;
  /** Start a new process; its first step happens `steps[0].dt` after `at`. */
  spawn(at: number, steps: Step[]): void;
  /** Insert steps right after the current one, in the same process. */
  insert(steps: Step[]): void;
}

interface Step {
  dt: number;
  cpu: number;
  build: (s: Readonly<KernelState>, ctx: StepCtx) => EventBody;
}

interface Proc {
  steps: Step[];
  i: number;
  ts: number;
  order: number;
}

/** Per cold read: what the completion side needs to know. */
interface ReadPlan {
  flow: number;
  ino: number;
  index: number;
  sector: number;
  bytes: number;
  /** Functions still open on the reader's stack, innermost last. */
  stack: string[];
  /** CPU reader slept on; set when it switches away. */
  lastCpu: number | null;
  /** Local wakeup on the interrupt CPU itself: switch in after softirq_exit. */
  switchAfterSoftirq: boolean;
}

export interface SimOptions {
  seed?: number;
  scenario?: Scenario;
}

export function createSim(opts: SimOptions = {}): EventSource {
  return new SimModel(opts.seed ?? DEFAULT_SEED, opts.scenario ?? COLD_WARM_READ);
}

/** Stream header for a scenario: the snapshot at ts = 0. */
export function buildHeader(sc: Scenario, seed: number): StreamHeader {
  const cpus: SnapshotCpu[] = [];
  for (let id = 0; id < sc.ncpu; id++) {
    const running = sc.tasks.find((t) => t.state === 'running' && t.cpu === id);
    cpus.push({
      id,
      current: running?.pid ?? 0,
      runqueue: sc.tasks.filter((t) => t.state === 'runnable' && t.cpu === id).map((t) => t.pid),
    });
  }
  const { fd: _fd, startSector: _s, ...file } = sc.file;
  return {
    schema: 'lkc-events/0',
    kernel: '6.18',
    arch: 'x86_64',
    ncpu: sc.ncpu,
    source: 'sim',
    seed,
    note: `Synthetic model, scenario ${sc.name}. Order follows evidence/read-path.md; all timings are illustrative (src/sim/costs.ts).`,
    snapshot: {
      cpus,
      tasks: sc.tasks.map((t) => ({ ...t })),
      files: [file],
      devices: [{ ...sc.device }],
      pageCache: [],
    },
  };
}

function checkScenario(sc: Scenario): void {
  const bad = (m: string): never => {
    throw new Error(`scenario ${sc.name}: ${m}`);
  };
  const reader = sc.tasks.find((t) => t.pid === sc.reader) ?? bad('reader is not a task');
  if (reader.state !== 'running' || reader.cpu === null || reader.mode !== 'user') bad('reader must run in user mode');
  const used = new Set<number>();
  for (const t of sc.tasks) {
    if (t.state === 'sleeping') bad(`task ${t.pid}: sleeping tasks are not modelled`);
    if (t.cpu === null || t.cpu < 0 || t.cpu >= sc.ncpu) bad(`task ${t.pid}: cpu out of range`);
    if (t.state === 'running') {
      if (used.has(t.cpu!)) bad(`two running tasks on cpu ${t.cpu}`);
      used.add(t.cpu!);
    }
  }
  for (const t of sc.tasks) {
    if (t.state === 'runnable' && !used.has(t.cpu!)) bad(`task ${t.pid}: queued on cpu ${t.cpu}, which runs nothing; no tick would ever pick it`);
  }
  if (sc.irqCpuCandidates.length === 0) bad('no interrupt CPU candidates');
  for (const c of sc.irqCpuCandidates) if (c < 0 || c >= sc.ncpu) bad(`interrupt CPU ${c} out of range`);
  // Replays the file position as startAction() moves it.
  let filePos = 0;
  sc.script.forEach((a, i) => {
    if (a.fd !== sc.file.fd) bad(`unknown fd ${a.fd}`);
    if (a.count <= 0) bad('count must be positive');
    if (a.op === 'pread64' && a.offset % PAGE_SIZE !== 0) bad('offsets must be page aligned');
    if (!(a.delayNs >= 1)) bad('delayNs must be at least 1');
    const pos = a.op === 'pread64' ? a.offset : filePos;
    const bytes = Math.min(a.count, sc.file.size - pos);
    if (bytes <= 0) bad(`action ${i}: read at end of file is not modelled`);
    if (Math.floor(pos / PAGE_SIZE) !== Math.floor((pos + bytes - 1) / PAGE_SIZE)) {
      bad(`action ${i}: bytes ${pos} to ${pos + bytes - 1} span two pages; each read must stay within one page`);
    }
    if (a.op === 'read') filePos = pos + bytes;
  });
}

const fnIn = (fn: string, flow: number): EventBody => ({ type: 'func_entry', tier: 'P', flow, fn });
const fnOut = (fn: string, flow: number, ret?: number): EventBody =>
  ret === undefined ? { type: 'func_exit', tier: 'P', flow, fn } : { type: 'func_exit', tier: 'P', flow, fn, ret };

const isIdle = (s: Readonly<KernelState>, cpu: number): boolean => {
  const c = s.cpus[cpu]!;
  return c.current === 0 && c.runqueue.length === 0;
};

class SimModel implements EventSource {
  readonly header: StreamHeader;
  private rng!: Rng;
  private agenda: Proc[] = [];
  private order = 0;
  private seq = 0;
  private irqCpu = 0;
  private filePos = 0;
  private nextFlow = 1;

  constructor(
    private readonly seed: number,
    private readonly sc: Scenario,
  ) {
    checkScenario(sc);
    this.header = buildHeader(sc, seed);
    this.reset();
  }

  reset(): void {
    this.rng = createRng(this.seed);
    this.agenda = [];
    this.order = 0;
    this.seq = 0;
    this.filePos = 0;
    this.nextFlow = 1;
    // Interrupt CPU rule (scenarios.ts, irqCpuCandidates): one seeded pick
    // per stream. Illustrative; the real effective CPU is not verified.
    const c = this.sc.irqCpuCandidates;
    this.irqCpu = c[this.rng.int(c.length)]!;
    const reader = this.sc.tasks.find((t) => t.pid === this.sc.reader)!;
    this.startAction(0, 0, reader.cpu!);
  }

  peek(): number | null {
    const p = this.head();
    return p ? p.ts : null;
  }

  next(state: Readonly<KernelState>): KEvent {
    if (state.seq !== this.seq - 1) {
      throw new Error(`sim: state is at seq ${state.seq}, expected the state after seq ${this.seq - 1}`);
    }
    const p = this.head();
    if (!p) throw new Error('sim: stream has ended');
    this.agenda.splice(this.agenda.indexOf(p), 1);
    const step = p.steps[p.i]!;
    const ctx: StepCtx = {
      now: p.ts,
      spawn: (at, steps) => this.spawn(at, steps),
      insert: (steps) => p.steps.splice(p.i + 1, 0, ...steps),
    };
    const body = step.build(state, ctx);
    const cpu = state.cpus[step.cpu] ?? fail(`no cpu ${step.cpu}`);
    // pid is the task current on that CPU. For tier S device events it is
    // informational (EVENT_SCHEMA.md, changes made by WP0).
    const ev = { seq: this.seq++, ts: p.ts, cpu: step.cpu, pid: cpu.current, ...body } as KEvent;
    p.i++;
    const nextStep = p.steps[p.i];
    if (nextStep) {
      p.ts += nextStep.dt;
      p.order = this.order++;
      this.agenda.push(p);
    }
    return ev;
  }

  // -------------------------------------------------------------------------
  // Agenda
  // -------------------------------------------------------------------------

  private head(): Proc | undefined {
    let best: Proc | undefined;
    for (const p of this.agenda) {
      if (!best || p.ts < best.ts || (p.ts === best.ts && p.order < best.order)) best = p;
    }
    return best;
  }

  private spawn(at: number, steps: Step[]): void {
    if (steps.length === 0) return;
    for (const s of steps) if (!(s.dt >= 1) || !Number.isInteger(s.dt)) fail(`step dt ${s.dt} must be a positive integer`);
    this.agenda.push({ steps, i: 0, ts: at + steps[0]!.dt, order: this.order++ });
  }

  // -------------------------------------------------------------------------
  // Script
  // -------------------------------------------------------------------------

  private startAction(i: number, at: number, cpu: number): void {
    const a = this.sc.script[i];
    if (!a) return;
    const pos = a.op === 'pread64' ? a.offset : this.filePos;
    const bytes = Math.min(a.count, this.sc.file.size - pos);
    if (bytes <= 0) fail(`action ${i}: read at end of file is not modelled`);
    // ksys_read stores the advanced position; pread64 leaves it alone.
    if (a.op === 'read') this.filePos = pos + bytes;
    const flow = this.nextFlow++;
    this.spawn(at, this.syscallEntry(a, i, cpu, flow, pos, bytes));
  }

  /** Steps 1 to 11: syscall entry down to the page cache lookup. The lookup
   *  reads the page cache state and spawns the cold or the warm tail. */
  private syscallEntry(a: ScenarioAction, actionIdx: number, cpu: number, flow: number, pos: number, bytes: number): Step[] {
    const C = COSTS;
    const args = a.op === 'pread64' ? [a.fd, a.buf, a.count, a.offset] : [a.fd, a.buf, a.count];
    // pread64 reaches vfs_read through ksys_pread64 (read-path.md, "ksys_pread64").
    const chain = [
      'x64_sys_call',
      a.op === 'read' ? 'ksys_read' : 'ksys_pread64',
      'vfs_read',
      'new_sync_read',
      'ext4_file_read_iter',
      'generic_file_read_iter',
      'filemap_read',
      'filemap_get_pages',
    ];
    const ino = this.sc.file.ino;
    const index = Math.floor(pos / PAGE_SIZE);
    const steps: Step[] = [
      // Step 2: sys_enter fires in do_syscall_64's entry work.
      { dt: a.delayNs + C.SYSCALL_ENTRY_NS, cpu, build: () => ({ type: 'sys_enter', tier: 'T', flow, name: a.op, args }) },
      // Steps 3 to 10.
      ...chain.map((fn): Step => ({ dt: C.FN_CALL_NS, cpu, build: () => fnIn(fn, flow) })),
    ];
    steps.push({
      // Step 11: filemap_get_read_batch.
      dt: C.PAGE_CACHE_LOOKUP_NS,
      cpu,
      build: (s, ctx) => {
        const have = s.pageCache[pageKey(ino, index)];
        if (have === 'locked') fail('lookup of a page under read is not modelled in Stage 1');
        const hit = have === 'uptodate';
        const stack = [...chain];
        if (hit) {
          ctx.spawn(ctx.now, this.returnPath(cpu, flow, bytes, stack, actionIdx));
        } else {
          const plan: ReadPlan = {
            flow,
            ino,
            index,
            sector: this.sc.file.startSector + index * SECTORS_PER_PAGE,
            bytes,
            stack,
            lastCpu: null,
            switchAfterSoftirq: false,
          };
          ctx.spawn(ctx.now, this.coldSubmit(cpu, plan, actionIdx));
        }
        return { type: 'page_cache_lookup', tier: 'P', flow, ino, index, hit };
      },
    });
    return steps;
  }

  /** Steps 12 to 35: readahead of one page, bio submission, plug flush,
   *  mq-deadline insert, driver issue, notify, and sleep on the folio lock. */
  private coldSubmit(cpu: number, plan: ReadPlan, actionIdx: number): Step[] {
    const C = COSTS;
    const { flow } = plan;
    const dev = this.sc.device.dev;
    const blk = { dev, sector: plan.sector, nrSectors: SECTORS_PER_PAGE };
    const at = (dt: number, build: Step['build']): Step => ({ dt, cpu, build });
    const call = (fn: string, dt: number = C.FN_CALL_NS) => at(dt, () => fnIn(fn, flow));
    const ret = (fn: string, r?: number) => at(C.FN_RETURN_NS, () => fnOut(fn, flow, r));
    return [
      // Step 12. At offset 0 the kernel sets a 4-page window, 3 pages async
      // (read-path.md "Readahead on a cold read"). The model reads page 0
      // only: the allocations, inserts and completions of pages 1 to 3 and
      // the readahead mark are skipped (docs/stage-1/README.md, readahead out
      // of scope). The bio is one request either way.
      call('page_cache_sync_ra'),
      // Steps 13 and 14: page_cache_ra_order, filemap_alloc_folio (order 0).
      at(C.PAGE_ALLOC_NS, () => ({ type: 'mm_page_alloc', tier: 'T', flow, order: 0 })),
      // Step 15: filemap_add_folio inserts the folio locked.
      at(C.PAGE_CACHE_INSERT_NS, () => ({ type: 'mm_filemap_add_to_page_cache', tier: 'T', flow, ino: plan.ino, index: plan.index })),
      // Step 16: read_pages opens a plug (no event), then steps 17 and 18.
      call('ext4_readahead'),
      call('ext4_mpage_readpages', C.BIO_BUILD_NS),
      // Steps 19 to 22.
      call('submit_bio'),
      call('submit_bio_noacct'),
      at(C.FN_CALL_NS, () => ({ type: 'block_bio_queue', tier: 'T', flow, ...blk })),
      call('blk_mq_submit_bio'),
      // The request goes on the plug from read_pages.
      at(C.BLOCK_QUEUE_NS, () => fnOut('blk_mq_submit_bio', flow)),
      ret('submit_bio_noacct'),
      ret('submit_bio'),
      ret('ext4_mpage_readpages', 0),
      ret('ext4_readahead'),
      // Step 23: read_pages finishes the plug. Steps 24 and 25: with a
      // scheduler the plug goes to mq-deadline, which fires block_rq_insert.
      call('blk_finish_plug'),
      at(C.SCHED_INSERT_NS, () => ({ type: 'block_rq_insert', tier: 'T', flow, ...blk })),
      // Steps 26 to 28: the hardware queue runs on this CPU and calls queue_rq.
      call('virtio_queue_rq'),
      // Step 29: blk_mq_start_request inside virtblk_prep_rq.
      at(C.DRIVER_PREP_NS, () => ({ type: 'block_rq_issue', tier: 'T', flow, ...blk })),
      // Step 30: virtqueue_notify hands the request to the device. cpu is the
      // CPU that will take the interrupt (EVENT_SCHEMA.md, changes by WP0).
      {
        dt: C.NOTIFY_NS,
        cpu: this.irqCpu,
        build: (_s, ctx) => {
          ctx.spawn(ctx.now, this.completion(plan, actionIdx));
          return { type: 'hw_io_start', tier: 'S', flow, dev, sector: plan.sector };
        },
      },
      ret('virtio_queue_rq', 0),
      ret('blk_finish_plug'),
      ret('page_cache_sync_ra'),
      // Step 31: the second lookup finds folio 0 locked and not up to date.
      // It has no event: page_cache_lookup only reports hit or miss.
      // Step 32: filemap_update_page cannot take the lock (no event).
      // Step 33: folio_wait_bit_common queues a waiter and sleeps.
      call('folio_wait_bit_common'),
      // Steps 34 and 35: io_schedule, __schedule. reader leaves in D
      // (TASK_KILLABLE, evidence/tracepoints.md sched-switch).
      at(C.WAIT_SETUP_NS + C.CONTEXT_SWITCH_NS, (s) => {
        plan.lastCpu = cpu;
        plan.stack.push('folio_wait_bit_common');
        const next = s.cpus[cpu]!.runqueue[0] ?? 0;
        return { type: 'sched_switch', tier: 'T', prevPid: this.sc.reader, prevState: 'D', nextPid: next };
      }),
    ];
  }

  /** Steps 36 to 53 on the interrupt CPU: device done, hardirq, BLOCK
   *  softirq, page up to date, wakeup. Single queue, interrupt CPU sharing a
   *  cache with the submitter (read-path.md "Interrupt and softirq context",
   *  case 3; cache sharing is an open question). */
  private completion(plan: ReadPlan, actionIdx: number): Step[] {
    const C = COSTS;
    const cpu = this.irqCpu;
    const { flow } = plan;
    const { dev, irq, irqName } = this.sc.device;
    const blk = { dev, sector: plan.sector, nrSectors: SECTORS_PER_PAGE };
    const at = (dt: number, build: Step['build']): Step => ({ dt, cpu, build });
    const call = (fn: string) => at(C.HANDLER_STEP_NS, () => fnIn(fn, flow));
    const ret = (fn: string, r?: number) => at(C.HANDLER_STEP_NS, () => fnOut(fn, flow, r));
    return [
      // Step 36: the device puts the buffer on the used ring. Seeded jitter.
      at(deviceLatency(this.rng), () => ({ type: 'hw_io_done', tier: 'S', flow, dev, sector: plan.sector })),
      // Step 37.
      at(C.IRQ_DELIVERY_NS, () => ({ type: 'irq_handler_entry', tier: 'T', flow, irq, name: irqName })),
      // Steps 38 to 41.
      call('vring_interrupt'),
      call('virtblk_done'),
      call('blk_mq_complete_request'),
      at(C.HANDLER_STEP_NS, () => ({ type: 'softirq_raise', tier: 'T', flow, vec: SOFTIRQ.BLOCK })),
      ret('blk_mq_complete_request'),
      ret('virtblk_done'),
      ret('vring_interrupt', 1),
      // Step 42: IRQ_HANDLED.
      at(C.HANDLER_STEP_NS, () => ({ type: 'irq_handler_exit', tier: 'T', flow, irq, ret: 1 })),
      // Step 43: irq_exit runs the pending BLOCK softirq.
      at(C.SOFTIRQ_ENTRY_NS, () => ({ type: 'softirq_entry', tier: 'T', flow, vec: SOFTIRQ.BLOCK })),
      // Step 44. Step 45 (virtblk_request_done) has no event.
      call('blk_done_softirq'),
      // Step 46: blk_update_request.
      at(C.HANDLER_STEP_NS, () => ({ type: 'block_rq_complete', tier: 'T', flow, ...blk, error: 0 })),
      // Step 47. Step 48 (mpage_end_io) has no event.
      call('bio_endio'),
      // Step 49: up to date and unlocked in one step.
      at(C.HANDLER_STEP_NS, () => ({ type: 'folio_end_read', tier: 'P', flow, ino: plan.ino, index: plan.index, ok: true })),
      // Steps 50 and 51: folio_wake_bit, try_to_wake_up.
      at(C.HANDLER_STEP_NS, (s, ctx) => this.waking(s, ctx, plan, actionIdx)),
      ret('bio_endio'),
      ret('blk_done_softirq'),
      // Step 53.
      at(C.HANDLER_STEP_NS, (_s, ctx) => {
        if (plan.switchAfterSoftirq) ctx.spawn(ctx.now, this.switchIn(cpu, plan, actionIdx, C.CONTEXT_SWITCH_NS));
        return { type: 'softirq_exit', tier: 'T', flow, vec: SOFTIRQ.BLOCK };
      }),
    ];
  }

  /**
   * Step 51, sched_waking, and the placement decision.
   *
   * Wakeup placement rule (a model decision; the kernel's
   * select_task_rq_fair depends on load, evidence/open-questions.md "Wakeup
   * placement"): reader's previous CPU if it is idle; otherwise one of the
   * idle CPUs, picked with the seeded RNG; otherwise the previous CPU. "Idle"
   * means the idle task is current and the runqueue is empty.
   *
   * Where sched_wakeup fires follows ttwu_queue_cond
   * (read-path.md "Interrupt CPU and wakeup CPU"): a remote, idle target gets
   * the task through its wake list and fires sched_wakeup itself; otherwise
   * ttwu_do_wakeup fires it here, on the waking CPU. A busy target is
   * preempted by the woken task (wakeup preemption, no tick in Stage 1).
   */
  private waking(s: Readonly<KernelState>, ctx: StepCtx, plan: ReadPlan, actionIdx: number): EventBody {
    const C = COSTS;
    const wakee = this.sc.reader;
    const waker = this.irqCpu;
    if (s.tasks[wakee]?.state !== 'sleeping' || plan.lastCpu === null) {
      fail('completion overtook the sleep: reader is not asleep at sched_waking');
    }
    const prev = plan.lastCpu!;
    const target = this.chooseWakeCpu(s, prev);
    const wakeup = (): EventBody => ({ type: 'sched_wakeup', tier: 'T', flow: plan.flow, wakee, targetCpu: target });
    if (target !== waker && isIdle(s, target)) {
      ctx.spawn(ctx.now, [
        { dt: C.WAKE_IPI_NS, cpu: target, build: wakeup },
        ...this.switchIn(target, plan, actionIdx, C.CONTEXT_SWITCH_NS),
      ]);
    } else {
      ctx.insert([
        {
          dt: C.WAKE_NS,
          cpu: waker,
          build: (_s, c) => {
            if (target === waker) plan.switchAfterSoftirq = true;
            else c.spawn(c.now, this.switchIn(target, plan, actionIdx, C.RESCHED_NS));
            return wakeup();
          },
        },
      ]);
    }
    // sched_waking reports the CPU the task last ran on: it fires before the
    // choice (evidence/tracepoints.md, sched-waking).
    return { type: 'sched_waking', tier: 'T', flow: plan.flow, wakee, targetCpu: prev };
  }

  private chooseWakeCpu(s: Readonly<KernelState>, prev: number): number {
    if (isIdle(s, prev)) return prev;
    const idle: number[] = [];
    for (const c of s.cpus) if (isIdle(s, c.id)) idle.push(c.id);
    if (idle.length > 0) return idle[this.rng.int(idle.length)]!;
    return prev;
  }

  /** Step 54 and the return path: reader is switched in on `cpu`. */
  private switchIn(cpu: number, plan: ReadPlan, actionIdx: number, dt: number): Step[] {
    return [
      {
        dt,
        cpu,
        build: (s) => {
          const c = s.cpus[cpu]!;
          if (c.context === 'hardirq' || c.context === 'softirq') fail(`cannot switch on cpu ${cpu} in ${c.context}`);
          // prev is the idle task or a preempted busy task; both stay runnable.
          return { type: 'sched_switch', tier: 'T', prevPid: c.current, prevState: 'R', nextPid: this.sc.reader };
        },
      },
      // Step 55, the retry lookup that finds folio 0 up to date, is skipped,
      // as in the WP0 fixture: it would count as a second cache hit.
      ...this.returnPath(cpu, plan.flow, plan.bytes, plan.stack, actionIdx),
    ];
  }

  /** Steps 56 to 58: copy to user, unwind the stack, sys_exit. */
  private returnPath(cpu: number, flow: number, bytes: number, stack: string[], actionIdx: number): Step[] {
    const C = COSTS;
    const RETURNS_INT = new Set(['filemap_get_pages', 'folio_wait_bit_common']);
    const steps: Step[] = [];
    const open = [...stack];
    // Unwind to filemap_read: folio_wait_bit_common, filemap_get_pages.
    while (open.length > 0 && open.at(-1) !== 'filemap_read') {
      const fn = open.pop()!;
      steps.push({ dt: C.FN_RETURN_NS, cpu, build: () => fnOut(fn, flow, RETURNS_INT.has(fn) ? 0 : undefined) });
    }
    // Step 56: copy_page_to_iter.
    steps.push({ dt: C.COPY_TO_USER_NS, cpu, build: () => ({ type: 'copy_to_user', tier: 'P', flow, bytes }) });
    // Step 57 and the callers up to x64_sys_call return the byte count.
    while (open.length > 0) {
      const fn = open.pop()!;
      steps.push({ dt: C.FN_RETURN_NS, cpu, build: () => fnOut(fn, flow, bytes) });
    }
    // Step 58: sys_exit, then the next action of the script.
    const name = this.sc.script[actionIdx]!.op;
    steps.push({
      dt: C.SYSCALL_EXIT_NS,
      cpu,
      build: (_s, ctx) => {
        this.startAction(actionIdx + 1, ctx.now, cpu);
        return { type: 'sys_exit', tier: 'T', flow, name, ret: bytes };
      },
    });
    return steps;
  }
}

function fail(msg: string): never {
  throw new Error(`sim: ${msg}`);
}
