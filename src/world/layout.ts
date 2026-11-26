// The only place with coordinates (ARCHITECTURE.md, rule 4).
// One unit is about one metre. Y is up. North is -Z: user space at the top of
// the screen, hardware at the bottom. First version by WP0; WP3 owns it now.
//
// Everything that places something on the map lives here: zones, districts,
// stations, routes, homes for tasks, shelf slots for pages, queue slots,
// offsets for entities that share a station, entity sizes and draw layers.
// Other modules refer to stations by id and ask this file for points.

import type { StationId } from '../core/types';

export interface Point {
  x: number;
  z: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type ZoneId = 'userland' | 'gate' | 'kernel' | 'hardware';

export const ZONES: Readonly<Record<ZoneId, Bounds>> = {
  userland: { minX: -60, maxX: 60, minZ: -60, maxZ: -41 },
  gate: { minX: -60, maxX: 60, minZ: -39, maxZ: -32.5 },
  kernel: { minX: -60, maxX: 60, minZ: -30.5, maxZ: 21.5 },
  hardware: { minX: -60, maxX: 60, minZ: 24, maxZ: 40 },
};

export const ZONE_LABELS: Readonly<Record<ZoneId, string>> = {
  userland: 'User Code',
  gate: 'Syscall gate',
  kernel: 'Kernel city',
  hardware: 'Hardware coast',
};

/** The whole map. The camera fits this on start. */
export const MAP_BOUNDS: Bounds = { minX: -60, maxX: 60, minZ: -60, maxZ: 40 };

export type DistrictId =
  | 'scheduler' | 'vfs' | 'page_cache' | 'block' | 'drivers' | 'interrupts'
  | 'memory' | 'network' | 'signals';

export interface DistrictBounds extends Bounds {
  stage: number;
  label: string;
}

/** Districts of the kernel city. Later-stage ones are drawn as empty lots. */
export const DISTRICTS: Readonly<Record<DistrictId, DistrictBounds>> = {
  vfs: { minX: -48, maxX: -24, minZ: -28, maxZ: -10.5, stage: 1, label: 'VFS quarter' },
  page_cache: { minX: -17, maxX: 6, minZ: -28, maxZ: -10.5, stage: 1, label: 'Page cache warehouse' },
  scheduler: { minX: 18, maxX: 58, minZ: -28, maxZ: 20, stage: 1, label: 'Scheduler plaza' },
  block: { minX: -17, maxX: 6, minZ: -6, maxZ: 4, stage: 1, label: 'Block depot' },
  drivers: { minX: -17, maxX: 6, minZ: 11, maxZ: 19, stage: 1, label: 'Driver row' },
  interrupts: { minX: -48, maxX: -24, minZ: 5, maxZ: 20, stage: 1, label: 'Interrupt dispatch' },
  memory: { minX: -48, maxX: -24, minZ: -7, maxZ: -1, stage: 3, label: 'Memory yard' },
  network: { minX: -59, maxX: -51, minZ: -28, maxZ: 20, stage: 5, label: 'Network\ndistrict' },
  signals: { minX: 9, maxX: 16, minZ: -28, maxZ: -18, stage: 4, label: 'Signal\noffice' },
};

/** Later-stage hardware on the coast, drawn as empty lots. */
export const HARDWARE_LOTS: ReadonlyArray<Bounds & { stage: number; label: string }> = [
  { minX: -58, maxX: -46, minZ: 26.5, maxZ: 38, stage: 3, label: 'RAM' },
  { minX: -42, maxX: -32, minZ: 26.5, maxZ: 38, stage: 5, label: 'NIC' },
  { minX: -28, maxX: -18, minZ: 26.5, maxZ: 38, stage: 2, label: 'Timer' },
  { minX: 4, maxX: 16, minZ: 26.5, maxZ: 38, stage: 4, label: 'Keyboard' },
];

/** Where a district's or lot's name is written: inside, near its north-west corner. */
export function labelPoint(b: Bounds): Point {
  return { x: b.minX + 1, z: b.minZ + 1.6 };
}

/** Where a zone's name is written: close to its north-west corner. */
export function zoneLabelPoint(b: Bounds): Point {
  return { x: b.minX + 1, z: b.minZ + 0.9 };
}

export function centre(b: Bounds): Point {
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
}

export function inside(b: Bounds, p: Point): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;
}

// ---------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------

const FIXED: Readonly<Record<string, Point>> = {
  user: { x: -30, z: -48 },
  syscall_gate: { x: -30, z: -35 },
  vfs: { x: -42, z: -22 },
  'fs:ext4': { x: -30, z: -18 },
  page_cache: { x: -5, z: -14.5 },
  block: { x: -5, z: -1 },
  'driver:virtio_blk': { x: -5, z: 14 },
  'device:vda': { x: -5, z: 31 },
  irq: { x: -40, z: 14 },
  softirq: { x: -30, z: 8 },
};

/** Display names for the station pads. */
export const STATION_LABELS: Readonly<Record<string, string>> = {
  user: 'user',
  syscall_gate: 'gate',
  vfs: 'vfs',
  'fs:ext4': 'ext4',
  page_cache: 'page cache',
  block: 'block',
  'driver:virtio_blk': 'virtio_blk',
  'device:vda': 'disk vda',
  irq: 'irq',
  softirq: 'softirq',
};

/** Fixed stations that get a drawn pad. Per-CPU ones are drawn by the plaza and coast. */
export const FIXED_STATIONS = Object.keys(FIXED) as StationId[];

const CPU_X0 = 24;
const CPU_DX = 10;
/** z of the runqueue lane head (where an idle CPU token waits). */
const LANE_HEAD_Z = -20;
/** Plaza lanes run from the head south to here. */
const LANE_END_Z = 18;
const CORE_Z = 31;
/** Spacing of queued task chips behind the lane head. */
const QUEUE_DZ = 4;

/** Coordinates of a station. Per-CPU stations are laid out as lanes. */
export function stationPoint(id: StationId): Point {
  const fixed = FIXED[id];
  if (fixed) return fixed;
  const m = /^(runqueue|cpu):(\d+)$/.exec(id);
  if (m) {
    const x = cpuLaneX(Number(m[2]));
    // The CPU core sits on the hardware coast; its runqueue lane in the plaza.
    return m[1] === 'cpu' ? { x, z: CORE_Z } : { x, z: LANE_HEAD_Z };
  }
  throw new Error(`layout: no coordinates for station ${id}`);
}

export function cpuLaneX(cpu: number): number {
  return CPU_X0 + cpu * CPU_DX;
}

/** The drawn strip of a CPU's lane in the scheduler plaza. */
export function laneBounds(cpu: number): Bounds {
  const x = cpuLaneX(cpu);
  return { minX: x - 3, maxX: x + 3, minZ: LANE_HEAD_Z - 2.5, maxZ: LANE_END_Z };
}

/** Slot of the n-th queued task (0 = next to run) in a CPU's runqueue lane. */
export function queueSlot(cpu: number, n: number): Point {
  return { x: cpuLaneX(cpu), z: LANE_HEAD_Z + QUEUE_DZ * (n + 1) };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** Adjacent station pairs that have a drawn route. Routes are undirected. */
export const ROUTES: ReadonlyArray<readonly [StationId, StationId]> = [
  ['user', 'syscall_gate'],
  ['syscall_gate', 'vfs'],
  ['vfs', 'fs:ext4'],
  ['fs:ext4', 'page_cache'],
  ['syscall_gate', 'page_cache'],
  ['page_cache', 'block'],
  ['fs:ext4', 'block'],
  ['block', 'driver:virtio_blk'],
  ['driver:virtio_blk', 'device:vda'],
  ['device:vda', 'irq'],
  ['irq', 'driver:virtio_blk'],
  ['irq', 'softirq'],
  ['softirq', 'block'],
];

function neighbours(s: StationId): StationId[] {
  const out: StationId[] = [];
  for (const [a, b] of ROUTES) {
    if (a === s) out.push(b);
    else if (b === s) out.push(a);
  }
  return out;
}

/** Stations passed on the shortest route from a to b, both ends included.
 *  Breadth-first over ROUTES; [a, b] if no route connects them. */
export function stationPath(a: StationId, b: StationId): StationId[] {
  if (a === b) return [a];
  const prev = new Map<StationId, StationId>();
  const seen = new Set<StationId>([a]);
  const queue: StationId[] = [a];
  while (queue.length > 0) {
    const s = queue.shift()!;
    for (const n of neighbours(s)) {
      if (seen.has(n)) continue;
      seen.add(n);
      prev.set(n, s);
      if (n === b) {
        const path: StationId[] = [b];
        for (let p = prev.get(b); p !== undefined; p = prev.get(p)) path.unshift(p);
        return path;
      }
      queue.push(n);
    }
  }
  return [a, b];
}

/** Polyline from a to b along known routes, or a straight line if none. */
export function routeBetween(a: StationId, b: StationId): Point[] {
  return stationPath(a, b).map(stationPoint);
}

// ---------------------------------------------------------------------------
// Homes and slots for entities
// ---------------------------------------------------------------------------

/** House plots in userland, one per user task in pid order. Slot 0 sits
 *  above the gate. */
const USER_HOME_X = [-30, -14, 2, 18, 34, 50, -46];
const USER_HOME_Z = -50;

export function userHome(slot: number): Point {
  const x = USER_HOME_X[slot % USER_HOME_X.length]!;
  const row = Math.floor(slot / USER_HOME_X.length);
  return { x, z: USER_HOME_Z + row * 6 };
}

export function userHomeBounds(slot: number): Bounds {
  const p = userHome(slot);
  return { minX: p.x - 6, maxX: p.x + 6, minZ: p.z - 5, maxZ: p.z + 4 };
}

/** Where kernel threads live when their station is not a kernel place.
 *  Inside the kernel zone, south of the gate (CITY_MAP accuracy rule 5). */
export function kthreadHome(slot: number): Point {
  return { x: 10 + (slot % 2) * 2, z: -8 + Math.floor(slot / 2) * 3 };
}

/** Offset for the n-th of several tasks standing at the same station. */
export function crowdOffset(n: number): Point {
  if (n === 0) return { x: 0, z: 0 };
  const ring = Math.ceil(n / 6);
  const a = ((n - 1) % 6) * (Math.PI / 3);
  return { x: Math.cos(a) * 2.6 * ring, z: Math.sin(a) * 2.6 * ring };
}

/** A CPU token riding on a task sits on its north-east shoulder. */
export const TOKEN_ON_TASK: Point = { x: 1.6, z: -1.6 };
/** A CPU token working in irq or softirq context stands next to the station,
 *  one place per CPU. */
export function tokenAtHandler(station: 'irq' | 'softirq', cpu: number): Point {
  const p = stationPoint(station);
  return { x: p.x - 3 + cpu * 2, z: p.z + 3 };
}

/** A flow (the request's work) carried by its task sits on its south-west shoulder. */
export const FLOW_ON_TASK: Point = { x: -1.6, z: 1.4 };
/** A flow on its own stands just south-east of its station. */
export function flowAtStation(station: StationId, n: number): Point {
  const p = stationPoint(station);
  return { x: p.x + 2.4 + n * 1.6, z: p.z + 2.2 };
}

/** Block request cargo stacks to the east of its station. */
export function requestSlot(station: StationId, n: number): Point {
  const p = stationPoint(station);
  return { x: p.x + 4 + (n % 4) * 1.8, z: p.z - 1 + Math.floor(n / 4) * 1.8 };
}

/** Warehouse shelves: one row per file, one tile per page. */
const SHELF_X0 = -15;
const SHELF_DX = 2.2;
const SHELF_Z0 = -23;
const SHELF_DZ = 2.6;
export const SHELF_PAGES_PER_ROW = 10;

export function shelfSlot(fileRow: number, index: number): Point {
  const col = index % SHELF_PAGES_PER_ROW;
  const sub = Math.floor(index / SHELF_PAGES_PER_ROW);
  return { x: SHELF_X0 + col * SHELF_DX, z: SHELF_Z0 + (fileRow + sub) * SHELF_DZ };
}

/** Label for a shelf row, west of the first tile. */
export function shelfLabelPoint(fileRow: number): Point {
  const p = shelfSlot(fileRow, 0);
  return { x: p.x - 1, z: p.z - 1.6 };
}

/** Name of a station, written under its pad. */
export function padLabelPoint(station: StationId): Point {
  const p = stationPoint(station);
  return { x: p.x, z: p.z + 2.6 };
}

/** Lane name, above the lane head. */
export function laneLabelPoint(cpu: number): Point {
  return { x: cpuLaneX(cpu), z: LANE_HEAD_Z - 4.2 };
}

/** Core name, south of the core. */
export function coreLabelPoint(cpu: number): Point {
  const p = stationPoint(`cpu:${cpu}`);
  return { x: p.x, z: p.z + 4.4 };
}

/** Name of a task's house, along its south edge (the task stands above it). */
export function userHomeLabelPoint(slot: number): Point {
  const b = userHomeBounds(slot);
  return { x: (b.minX + b.maxX) / 2, z: b.maxZ - 1.2 };
}

/** Name of a moving entity: tasks above, cargo and tokens beside. */
export const ENTITY_LABEL_OFFSET = {
  task: { x: 0, z: -3.2 },
  flow: { x: 0, z: 1.5 },
  queueChip: { x: 3.4, z: 0 },
} as const;

/** Wall segments of the gate: the full width minus the opening. */
export function gateWallSegments(): Array<{ from: Point; to: Point }> {
  const g = stationPoint('syscall_gate');
  const b = ZONES.gate;
  const half = GATE_OPENING_HALF_WIDTH;
  return [
    { from: { x: b.minX, z: g.z }, to: { x: g.x - half, z: g.z } },
    { from: { x: g.x + half, z: g.z }, to: { x: b.maxX, z: g.z } },
  ];
}

/** Road from a task's house to the gate. */
export function homeRoad(slot: number): Point[] {
  return [userHome(slot), stationPoint('syscall_gate')];
}

/** The gate wall runs across the map; the opening is at the syscall_gate station. */
export const GATE_OPENING_HALF_WIDTH = 3;

// ---------------------------------------------------------------------------
// Sizes and draw layers
// ---------------------------------------------------------------------------

export const SIZES = {
  task: 1.3,
  token: 0.8,
  flow: 0.7,
  request: 0.7,
  page: 0.85,
  queueChip: 1.0,
  stationPad: 1.8,
  core: 3.2,
  road: 0.9,
  gateWall: 1.6,
  label: 1.6,
  smallLabel: 1.1,
  outline: 0.22,
} as const;

/** Height above ground for each kind of thing. Larger draws on top. */
export const LAYERS = {
  ground: 0,
  zone: 0.01,
  district: 0.02,
  road: 0.03,
  pad: 0.04,
  shelf: 0.05,
  chip: 0.06,
  request: 0.07,
  flow: 0.08,
  task: 0.09,
  token: 0.1,
  highlight: 0.11,
  label: 0.2,
} as const;
