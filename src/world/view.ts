// Pure mapping from KernelState to what the map shows: which look each
// entity has and where it belongs. No three.js, no clocks; it only reads.
// The renderer animates between the points this module returns.

import type {
  BlockRequest,
  CpuContext,
  KernelState,
  PageState,
  RequestStage,
  StationId,
  TaskState,
} from '../core/types';
import {
  FLOW_ON_TASK,
  TOKEN_ON_TASK,
  crowdOffset,
  flowAtStation,
  kthreadHome,
  queueSlot,
  requestSlot,
  shelfSlot,
  stationPoint,
  tokenAtHandler,
  userHome,
  type Point,
} from './layout';
import type { LookId } from './palette';

export const PAGE_SIZE = 4096;

export interface TaskView {
  pid: number;
  comm: string;
  kind: TaskState['kind'];
  mode: TaskState['mode'];
  state: TaskState['state'];
  station: StationId;
  cpu: number | null;
  /** Running and its CPU is executing the task's own code (rule 2). */
  hasCpu: boolean;
  /** Running, but its CPU is in hardirq or softirq context (rule 3). */
  interrupted: boolean;
  look: LookId;
  /** Where the task stands. */
  at: Point;
}

export type TokenPlace = 'task' | 'irq' | 'softirq' | 'lane';

export interface TokenView {
  cpu: number;
  context: CpuContext;
  look: LookId;
  place: TokenPlace;
  /** pid of the task the token rides on when place is 'task'. */
  carrying: number | null;
  /** Static point; when place is 'task' it is the task's anchor plus offset. */
  at: Point;
}

export interface QueueChipView {
  cpu: number;
  pid: number;
  slot: number;
  at: Point;
}

export interface PageView {
  ino: number;
  index: number;
  row: number;
  state: PageState;
  look: LookId;
  at: Point;
}

export interface RequestView {
  key: string;
  dev: string;
  sector: number;
  stage: RequestStage;
  flow: number | null;
  station: StationId;
  look: LookId;
  at: Point;
}

export interface FlowView {
  id: number;
  pid: number;
  name: string;
  station: StationId;
  /** Carried by its task: same station and the task holds a CPU. */
  carried: boolean;
  at: Point;
}

export interface CoreView {
  cpu: number;
  context: CpuContext;
  look: LookId;
  current: number;
  at: Point;
}

export interface WorldView {
  tasks: TaskView[];
  tokens: TokenView[];
  queues: QueueChipView[];
  pages: PageView[];
  requests: RequestView[];
  flows: FlowView[];
  cores: CoreView[];
  /** File rows on the warehouse shelves, in row order. */
  files: { ino: number; path: string; pages: number }[];
}

const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, z: a.z + b.z });

/** Stations north of the gate or on it, where a kernel thread never goes. */
const USER_SIDE: ReadonlySet<StationId> = new Set<StationId>(['user', 'syscall_gate']);

export function taskLook(t: TaskState, interrupted: boolean): LookId {
  const m = t.mode;
  if (t.state === 'runnable') return `task.${m}.runnable`;
  if (t.state === 'sleeping') return `task.${m}.sleeping`;
  if (interrupted) return `task.${m}.interrupted`;
  return `task.${m}`;
}

export function cpuLook(c: CpuContext): LookId {
  return `cpu.${c}`;
}

export function requestLook(stage: RequestStage): LookId {
  switch (stage) {
    case 'queued':
    case 'inserted':
      return 'request.queued';
    case 'issued':
      return 'request.issued';
    case 'in_device':
      return 'request.in_device';
    case 'device_done':
      return 'request.device_done';
  }
}

/** Station where a block request is, from its stage. */
export function requestStation(state: Readonly<KernelState>, r: BlockRequest): StationId {
  switch (r.stage) {
    case 'queued':
    case 'inserted':
      return 'block';
    case 'issued': {
      const d = state.header.snapshot.devices.find((x) => x.dev === r.dev);
      return `driver:${d?.driver ?? 'virtio_blk'}` as StationId;
    }
    case 'in_device':
    case 'device_done':
      return `device:${r.dev}` as StationId;
  }
}

function sortedTasks(state: Readonly<KernelState>): TaskState[] {
  return Object.values(state.tasks).sort((a, b) => a.pid - b.pid);
}

/** Where a task stands, given all tasks. Pure function of state. */
function taskAnchors(tasks: TaskState[]): Map<number, Point> {
  const out = new Map<number, Point>();
  let userSlot = 0;
  let kthreadSlot = 0;
  const crowd = new Map<StationId, number>();
  for (const t of tasks) {
    const home = t.kind === 'user' ? userSlot++ : kthreadSlot++;
    if (t.kind === 'user' && t.station === 'user') {
      out.set(t.pid, userHome(home));
      continue;
    }
    if (t.kind === 'kthread' && USER_SIDE.has(t.station)) {
      out.set(t.pid, kthreadHome(home));
      continue;
    }
    const n = crowd.get(t.station) ?? 0;
    crowd.set(t.station, n + 1);
    out.set(t.pid, add(stationPoint(t.station), crowdOffset(n)));
  }
  return out;
}

function pageRows(state: Readonly<KernelState>): WorldView['files'] {
  const rows = state.header.snapshot.files.map((f) => ({
    ino: f.ino,
    path: f.path,
    pages: Math.max(1, Math.ceil(f.size / PAGE_SIZE)),
  }));
  // Pages of files the snapshot does not list still get a shelf.
  for (const key of Object.keys(state.pageCache)) {
    const [inoS, idxS] = key.split(':');
    const ino = Number(inoS);
    const index = Number(idxS);
    let row = rows.find((r) => r.ino === ino);
    if (!row) {
      row = { ino, path: `ino ${ino}`, pages: 0 };
      rows.push(row);
    }
    row.pages = Math.max(row.pages, index + 1);
  }
  return rows;
}

export function viewOf(state: Readonly<KernelState>): WorldView {
  const all = sortedTasks(state);
  const anchors = taskAnchors(all);
  const cpuById = new Map(state.cpus.map((c) => [c.id, c]));

  const tasks: TaskView[] = all.map((t) => {
    const c = t.cpu === null ? undefined : cpuById.get(t.cpu);
    const running = t.state === 'running' && c !== undefined && c.current === t.pid;
    const interrupted = running && (c.context === 'hardirq' || c.context === 'softirq');
    return {
      pid: t.pid,
      comm: t.comm,
      kind: t.kind,
      mode: t.mode,
      state: t.state,
      station: t.station,
      cpu: t.cpu,
      hasCpu: running && !interrupted,
      interrupted,
      look: taskLook(t, interrupted),
      at: anchors.get(t.pid)!,
    };
  });
  const taskByPid = new Map(tasks.map((t) => [t.pid, t]));

  const tokens: TokenView[] = state.cpus.map((c) => {
    const base = { cpu: c.id, context: c.context, look: cpuLook(c.context) };
    if (c.context === 'hardirq' || c.context === 'softirq') {
      const place = c.context === 'hardirq' ? 'irq' : 'softirq';
      return { ...base, place, carrying: null, at: tokenAtHandler(place, c.id) };
    }
    const t = c.current === 0 ? undefined : taskByPid.get(c.current);
    if (t && c.context !== 'idle') {
      return { ...base, place: 'task', carrying: t.pid, at: add(t.at, TOKEN_ON_TASK) };
    }
    return { ...base, place: 'lane', carrying: null, at: stationPoint(`runqueue:${c.id}`) };
  });

  const queues: QueueChipView[] = [];
  for (const c of state.cpus) {
    c.runqueue.forEach((pid, slot) => queues.push({ cpu: c.id, pid, slot, at: queueSlot(c.id, slot) }));
  }

  const files = pageRows(state);
  const pages: PageView[] = [];
  files.forEach((f, row) => {
    for (let index = 0; index < f.pages; index++) {
      const st = state.pageCache[`${f.ino}:${index}`] ?? 'absent';
      pages.push({ ino: f.ino, index, row, state: st, look: `page.${st}`, at: shelfSlot(row, index) });
    }
  });

  const requests: RequestView[] = [];
  const reqCrowd = new Map<StationId, number>();
  for (const dev of Object.keys(state.blockQueues).sort()) {
    for (const r of state.blockQueues[dev] ?? []) {
      const station = requestStation(state, r);
      const n = reqCrowd.get(station) ?? 0;
      reqCrowd.set(station, n + 1);
      requests.push({
        key: `${r.dev}:${r.sector}`,
        dev: r.dev,
        sector: r.sector,
        stage: r.stage,
        flow: r.flow,
        station,
        look: requestLook(r.stage),
        at: requestSlot(station, n),
      });
    }
  }

  const flows: FlowView[] = [];
  const flowCrowd = new Map<StationId, number>();
  for (const f of Object.values(state.flows).sort((a, b) => a.id - b.id)) {
    const t = taskByPid.get(f.pid);
    const carried = t !== undefined && t.hasCpu && t.station === f.station;
    let at: Point;
    if (carried) {
      at = add(t.at, FLOW_ON_TASK);
    } else {
      const n = flowCrowd.get(f.station) ?? 0;
      flowCrowd.set(f.station, n + 1);
      at = flowAtStation(f.station, n);
    }
    flows.push({ id: f.id, pid: f.pid, name: f.name, station: f.station, carried, at });
  }

  const cores: CoreView[] = state.cpus.map((c) => ({
    cpu: c.id,
    context: c.context,
    look: cpuLook(c.context),
    current: c.current,
    at: stationPoint(`cpu:${c.id}`),
  }));

  return { tasks, tokens, queues, pages, requests, flows, cores, files };
}
