// Contracts shared by every part of the city. Nothing here does work.
// The prose version of these types is docs/EVENT_SCHEMA.md and
// docs/ARCHITECTURE.md; this file is the source of truth.

// ---------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------

/** A named place where a task or a request can be. See docs/CITY_MAP.md. */
export type StationId =
  | 'user'
  | 'syscall_gate'
  | 'vfs'
  | 'fs:ext4'
  | 'page_cache'
  | 'block'
  | 'driver:virtio_blk'
  | 'device:vda'
  | 'irq'
  | 'softirq'
  | `runqueue:${number}`
  | `cpu:${number}`;

// ---------------------------------------------------------------------------
// Stream header and snapshot
// ---------------------------------------------------------------------------

export type Arch = 'x86_64' | 'aarch64' | 'riscv64';
export type TaskKind = 'user' | 'kthread';
export type TaskMode = 'user' | 'kernel';
/** Scheduler view of a task. `sleeping` covers both S and D. */
export type TaskRunState = 'running' | 'runnable' | 'sleeping';
/** `prev_state` as the sched_switch tracepoint reports it, reduced to Stage 1. */
export type PrevState = 'R' | 'S' | 'D';
export type PageState = 'absent' | 'locked' | 'uptodate';

export interface SnapshotTask {
  pid: number;
  comm: string;
  kind: TaskKind;
  mode: TaskMode;
  state: TaskRunState;
  /** CPU the task runs on or is queued on; null while sleeping. */
  cpu: number | null;
}

export interface SnapshotCpu {
  id: number;
  /** pid of the current task; 0 is the idle task. */
  current: number;
  runqueue: number[];
}

export interface SnapshotFile {
  ino: number;
  path: string;
  size: number;
}

export interface SnapshotDevice {
  /** Device name as user space sees it, for example 'vda'. */
  dev: string;
  driver: 'virtio_blk';
  irq: number;
  irqName: string;
}

export interface SnapshotPage {
  ino: number;
  index: number;
  state: PageState;
}

/** What exists at ts = 0. A stream starts in the middle of a running system. */
export interface Snapshot {
  cpus: SnapshotCpu[];
  tasks: SnapshotTask[];
  files: SnapshotFile[];
  devices: SnapshotDevice[];
  pageCache: SnapshotPage[];
}

export interface StreamHeader {
  schema: 'lkc-events/0';
  /** Pinned kernel version the evidence refers to, for example '6.18'. */
  kernel: string;
  arch: Arch;
  ncpu: number;
  source: 'sim' | 'trace';
  /** Sim only. */
  seed?: number;
  /** Free text, for example 'hand-written fixture'. */
  note?: string;
  snapshot: Snapshot;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** T: tracepoint. P: function probe. S: synthetic, no kernel hook. */
export type Tier = 'T' | 'P' | 'S';

export interface KEventBase {
  /** Strictly increasing within a stream. */
  seq: number;
  /** ns since stream start, never decreases. */
  ts: number;
  /** CPU the event happened on. For tier S hardware events: the CPU that
   *  will take the resulting interrupt. */
  cpu: number;
  /** Task that was current on that CPU; 0 is the idle task. */
  pid: number;
  tier: Tier;
  /** Correlates the events of one request. */
  flow?: number;
}

export interface SysEnter extends KEventBase { type: 'sys_enter'; name: string; args: number[] }
export interface SysExit extends KEventBase { type: 'sys_exit'; name: string; ret: number }
export interface FuncEntry extends KEventBase { type: 'func_entry'; fn: string }
export interface FuncExit extends KEventBase { type: 'func_exit'; fn: string; ret?: number }
export interface PageCacheLookup extends KEventBase { type: 'page_cache_lookup'; ino: number; index: number; hit: boolean }
export interface MmPageAlloc extends KEventBase { type: 'mm_page_alloc'; order: number }
export interface MmFilemapAdd extends KEventBase { type: 'mm_filemap_add_to_page_cache'; ino: number; index: number }
/** Read completion marks the folio up to date and unlocks it. */
export interface FolioEndRead extends KEventBase { type: 'folio_end_read'; ino: number; index: number; ok: boolean }

interface BlockFields { dev: string; sector: number; nrSectors: number }
export interface BlockBioQueue extends KEventBase, BlockFields { type: 'block_bio_queue' }
export interface BlockRqInsert extends KEventBase, BlockFields { type: 'block_rq_insert' }
export interface BlockRqIssue extends KEventBase, BlockFields { type: 'block_rq_issue' }
export interface BlockRqComplete extends KEventBase, BlockFields { type: 'block_rq_complete'; error: number }
export interface HwIoStart extends KEventBase { type: 'hw_io_start'; dev: string; sector: number }
export interface HwIoDone extends KEventBase { type: 'hw_io_done'; dev: string; sector: number }

export interface IrqHandlerEntry extends KEventBase { type: 'irq_handler_entry'; irq: number; name: string }
export interface IrqHandlerExit extends KEventBase { type: 'irq_handler_exit'; irq: number; ret: number }
export interface SoftirqRaise extends KEventBase { type: 'softirq_raise'; vec: number }
export interface SoftirqEntry extends KEventBase { type: 'softirq_entry'; vec: number }
export interface SoftirqExit extends KEventBase { type: 'softirq_exit'; vec: number }

/** The tracepoint field is `pid`; renamed because the envelope already has
 *  `pid` for the current task. */
export interface SchedWaking extends KEventBase { type: 'sched_waking'; wakee: number; targetCpu: number }
export interface SchedWakeup extends KEventBase { type: 'sched_wakeup'; wakee: number; targetCpu: number }
export interface SchedSwitch extends KEventBase { type: 'sched_switch'; prevPid: number; prevState: PrevState; nextPid: number }

export interface CopyToUser extends KEventBase { type: 'copy_to_user'; bytes: number }

export type KEvent =
  | SysEnter | SysExit | FuncEntry | FuncExit
  | PageCacheLookup | MmPageAlloc | MmFilemapAdd | FolioEndRead
  | BlockBioQueue | BlockRqInsert | BlockRqIssue | BlockRqComplete | HwIoStart | HwIoDone
  | IrqHandlerEntry | IrqHandlerExit | SoftirqRaise | SoftirqEntry | SoftirqExit
  | SchedWaking | SchedWakeup | SchedSwitch
  | CopyToUser;

export type KEventType = KEvent['type'];
export type KEventOf<T extends KEventType> = Extract<KEvent, { type: T }>;

/** Every Stage 1 event type with its tier and required payload fields.
 *  validate.ts and the evidence coverage test read this table. */
export const EVENT_SPEC = {
  sys_enter: { tier: 'T', fields: ['name', 'args'] },
  sys_exit: { tier: 'T', fields: ['name', 'ret'] },
  func_entry: { tier: 'P', fields: ['fn'] },
  func_exit: { tier: 'P', fields: ['fn'] },
  page_cache_lookup: { tier: 'P', fields: ['ino', 'index', 'hit'] },
  mm_page_alloc: { tier: 'T', fields: ['order'] },
  mm_filemap_add_to_page_cache: { tier: 'T', fields: ['ino', 'index'] },
  folio_end_read: { tier: 'P', fields: ['ino', 'index', 'ok'] },
  block_bio_queue: { tier: 'T', fields: ['dev', 'sector', 'nrSectors'] },
  block_rq_insert: { tier: 'T', fields: ['dev', 'sector', 'nrSectors'] },
  block_rq_issue: { tier: 'T', fields: ['dev', 'sector', 'nrSectors'] },
  block_rq_complete: { tier: 'T', fields: ['dev', 'sector', 'nrSectors', 'error'] },
  hw_io_start: { tier: 'S', fields: ['dev', 'sector'] },
  hw_io_done: { tier: 'S', fields: ['dev', 'sector'] },
  irq_handler_entry: { tier: 'T', fields: ['irq', 'name'] },
  irq_handler_exit: { tier: 'T', fields: ['irq', 'ret'] },
  softirq_raise: { tier: 'T', fields: ['vec'] },
  softirq_entry: { tier: 'T', fields: ['vec'] },
  softirq_exit: { tier: 'T', fields: ['vec'] },
  sched_waking: { tier: 'T', fields: ['wakee', 'targetCpu'] },
  sched_wakeup: { tier: 'T', fields: ['wakee', 'targetCpu'] },
  sched_switch: { tier: 'T', fields: ['prevPid', 'prevState', 'nextPid'] },
  copy_to_user: { tier: 'P', fields: ['bytes'] },
} as const satisfies Record<KEventType, { tier: Tier; fields: readonly string[] }>;

export const EVENT_TYPES = Object.keys(EVENT_SPEC) as KEventType[];

/** Softirq vector numbers, as in the kernel's softirq enum. */
export const SOFTIRQ = { TIMER: 1, NET_TX: 2, NET_RX: 3, BLOCK: 4, SCHED: 7, RCU: 9 } as const;

// ---------------------------------------------------------------------------
// Kernel state
// ---------------------------------------------------------------------------

export type CpuContext = 'user' | 'kernel' | 'hardirq' | 'softirq' | 'idle';

export interface CpuState {
  id: number;
  /** pid of the current task; 0 is the idle task. */
  current: number;
  context: CpuContext;
  /** Contexts interrupted by hardirq or softirq, innermost last. */
  interrupted: CpuContext[];
  runqueue: number[];
}

export interface TaskState {
  pid: number;
  comm: string;
  kind: TaskKind;
  mode: TaskMode;
  state: TaskRunState;
  /** Set while sleeping: S interruptible, D uninterruptible. */
  sleep: 'S' | 'D' | null;
  /** True between sched_waking and sched_wakeup. */
  waking: boolean;
  cpu: number | null;
  /** Where in the kernel the task's own code is. Runqueue placement is
   *  derived from `state` and `cpu`, not stored here. */
  station: StationId;
}

export type RequestStage = 'queued' | 'inserted' | 'issued' | 'in_device' | 'device_done';

export interface BlockRequest {
  dev: string;
  sector: number;
  nrSectors: number;
  stage: RequestStage;
  flow: number | null;
}

export interface FlowState {
  id: number;
  kind: 'syscall';
  name: string;
  pid: number;
  /** Where the request's work currently is. Moves without the task while
   *  the task sleeps. */
  station: StationId;
  /** True from block_rq_issue until its task runs again: the task's own
   *  steps no longer move the request's work. */
  detached: boolean;
  startedAt: number;
}

export interface Counters {
  events: number;
  contextSwitches: number;
  cacheHits: number;
  cacheMisses: number;
  pagesAllocated: number;
  interrupts: number;
  softirqs: number;
  bytesCopied: number;
}

export interface KernelState {
  /** Sim time in ns of the last applied event. */
  now: number;
  /** seq of the last applied event, -1 before the first. */
  seq: number;
  header: StreamHeader;
  cpus: CpuState[];
  tasks: Record<number, TaskState>;
  /** Keyed by `${ino}:${index}`. Missing key means absent. */
  pageCache: Record<string, PageState>;
  blockQueues: Record<string, BlockRequest[]>;
  flows: Record<number, FlowState>;
  counters: Counters;
}

// ---------------------------------------------------------------------------
// Event sources
// ---------------------------------------------------------------------------

export interface EventSource {
  readonly header: StreamHeader;
  /** Timestamp in ns of the next event, or null when the stream has ended. */
  peek(): number | null;
  /** Produce exactly one event. The source may read state but not write it. */
  next(state: Readonly<KernelState>): KEvent;
  reset(): void;
}

// ---------------------------------------------------------------------------
// Bus
// ---------------------------------------------------------------------------

export type PresentationMode = 'event' | 'time' | 'step';

export type TransportCommand =
  | { action: 'play' }
  | { action: 'pause' }
  | { action: 'step' }
  | { action: 'reset' }
  | { action: 'speed'; value: number }
  | { action: 'mode'; mode: PresentationMode };

export type Selection =
  | { kind: 'task'; pid: number }
  | { kind: 'station'; station: StationId }
  | { kind: 'event'; seq: number }
  | { kind: 'flow'; flow: number }
  | { kind: 'zone'; zone: string }
  | { kind: 'district'; district: string }
  /** Any glossary entry by id, for concepts that are not on the map, such
   *  as a CPU context or a page state. See core/glossary.ts. */
  | { kind: 'info'; id: string };

export interface BusEvents {
  kevent: { event: KEvent; state: Readonly<KernelState> };
  'sim:reset': { header: StreamHeader; state: Readonly<KernelState> };
  'sim:end': { state: Readonly<KernelState> };
  transport: TransportCommand;
  select: Selection | null;
  hover: Selection | null;
  focus: { station: StationId };
}
