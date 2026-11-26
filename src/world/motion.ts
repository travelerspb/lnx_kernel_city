// Animation between the points view.ts returns. Pure: no three.js, no
// clocks; the caller passes wall time in ms.
//
// Rules from CITY_MAP.md that live here:
//  - A task moves only while it holds a CPU (rule 2). A task without one is
//    placed, never walked.
//  - A task walks along routes (rule 1: the task itself goes through the gate).
//  - A CPU token rides on its task and follows it; when it leaves (interrupt,
//    sleep) it travels on its own (rule 3).
//  - A flow moves on its own while its task sleeps (rule 4).

import type { StationId } from '../core/types';
import { stationPath, stationPoint, type Point } from './layout';
import type { WorldView } from './view';

export const DEFAULT_MOVE_MS = 320;
const EPS = 1e-6;

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function pathLength(path: readonly Point[]): number {
  let n = 0;
  for (let i = 1; i < path.length; i++) n += dist(path[i - 1]!, path[i]!);
  return n;
}

/** Point at fraction f (0..1) of the arc length of a polyline. */
export function pointAlong(path: readonly Point[], f: number): Point {
  const first = path[0];
  if (!first) throw new Error('pointAlong: empty path');
  const total = pathLength(path);
  if (total < EPS || f <= 0) return { ...first };
  if (f >= 1) return { ...path[path.length - 1]! };
  let left = f * total;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const d = dist(a, b);
    if (left <= d) {
      const k = d < EPS ? 0 : left / d;
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
    }
    left -= d;
  }
  return { ...path[path.length - 1]! };
}

/** Smooth start and stop. */
export function ease(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** Station points strictly between a and b on the route. */
export function viaPoints(a: StationId, b: StationId): Point[] {
  if (a === b) return [];
  return stationPath(a, b).slice(1, -1).map(stationPoint);
}

/** One animated point. The target may be moved while a tween runs, which is
 *  how a token keeps up with the task it rides on. */
export class Mover {
  pos: Point;
  target: Point;
  private start: Point;
  private via: Point[] = [];
  private elapsed = 0;
  private duration = 0;

  constructor(p: Point) {
    this.pos = { ...p };
    this.target = { ...p };
    this.start = { ...p };
  }

  get moving(): boolean {
    return this.elapsed < this.duration;
  }

  /** Start a tween from the current position through `via` to `target`. */
  moveTo(target: Point, via: Point[] = [], durationMs = DEFAULT_MOVE_MS): void {
    this.start = { ...this.pos };
    this.via = via.map((p) => ({ ...p }));
    this.target = { ...target };
    this.elapsed = 0;
    this.duration = Math.max(0, durationMs);
    if (this.duration === 0) this.snap(target);
  }

  /** Change the end point without restarting the tween. */
  retarget(target: Point): void {
    this.target = { ...target };
    if (!this.moving) this.pos = { ...target };
  }

  snap(p: Point): void {
    this.pos = { ...p };
    this.target = { ...p };
    this.start = { ...p };
    this.via = [];
    this.elapsed = this.duration = 0;
  }

  advance(dtMs: number): void {
    if (!this.moving) {
      this.pos = { ...this.target };
      return;
    }
    this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, dtMs));
    const path = [this.start, ...this.via, this.target];
    this.pos = pointAlong(path, ease(this.elapsed / this.duration));
  }
}

interface TaskMover {
  m: Mover;
  station: StationId;
}

interface FollowMover {
  m: Mover;
  /** Identifies where the mover is going; a change starts a new tween. */
  place: string;
  station?: StationId;
}

export interface MotionOptions {
  moveMs: number;
}

/** All moving entities of the map, keyed by identity. */
export class Motion {
  readonly tasks = new Map<number, TaskMover>();
  readonly tokens = new Map<number, FollowMover>();
  readonly flows = new Map<number, FollowMover>();
  readonly requests = new Map<string, FollowMover>();
  private opts: MotionOptions;

  constructor(opts: Partial<MotionOptions> = {}) {
    this.opts = { moveMs: DEFAULT_MOVE_MS, ...opts };
  }

  /** Forget all animation and place everything where the view says. */
  reset(view: WorldView): void {
    this.tasks.clear();
    this.tokens.clear();
    this.flows.clear();
    this.requests.clear();
    this.step(view, 0);
  }

  taskPos(pid: number): Point | undefined {
    return this.tasks.get(pid)?.m.pos;
  }

  /** Bring targets in line with the view, then advance by dtMs. */
  step(view: WorldView, dtMs: number): void {
    const ms = this.opts.moveMs;

    // Tasks first: tokens and flows follow their live positions.
    const seenT = new Set<number>();
    for (const t of view.tasks) {
      seenT.add(t.pid);
      let e = this.tasks.get(t.pid);
      if (!e) {
        e = { m: new Mover(t.at), station: t.station };
        this.tasks.set(t.pid, e);
        continue;
      }
      const changed = dist(e.m.target, t.at) > EPS;
      if (!t.hasCpu) {
        // Rule 2: no CPU, no walking. Finish any walk where it was heading.
        if (changed || e.m.moving) e.m.snap(t.at);
      } else if (changed) {
        e.m.moveTo(t.at, viaPoints(e.station, t.station), ms);
      }
      e.station = t.station;
      e.m.advance(dtMs);
    }
    for (const pid of [...this.tasks.keys()]) if (!seenT.has(pid)) this.tasks.delete(pid);

    // A rider's view point is the task's anchor plus an offset. Keep the
    // offset, but apply it to where the task is now, not where it will be.
    const live = (pid: number | null, riderAt: Point): Point => {
      if (pid === null) return riderAt;
      const p = this.taskPos(pid);
      const t = view.tasks.find((x) => x.pid === pid);
      if (!p || !t) return riderAt;
      return { x: p.x + riderAt.x - t.at.x, z: p.z + riderAt.z - t.at.z };
    };

    const seenK = new Set<number>();
    for (const k of view.tokens) {
      seenK.add(k.cpu);
      const place = k.place === 'task' ? `task:${k.carrying}` : k.place;
      const target = k.place === 'task' ? live(k.carrying, k.at) : k.at;
      this.follow(this.tokens, k.cpu, place, target, [], dtMs, ms);
    }
    for (const id of [...this.tokens.keys()]) if (!seenK.has(id)) this.tokens.delete(id);

    const seenF = new Set<number>();
    for (const f of view.flows) {
      seenF.add(f.id);
      const place = f.carried ? `task:${f.pid}` : `station:${f.station}`;
      const target = f.carried ? live(f.pid, f.at) : f.at;
      const prev = this.flows.get(f.id);
      const via = prev?.station !== undefined ? viaPoints(prev.station, f.station) : [];
      this.follow(this.flows, f.id, place, target, via, dtMs, ms, f.station);
    }
    for (const id of [...this.flows.keys()]) if (!seenF.has(id)) this.flows.delete(id);

    const seenR = new Set<string>();
    for (const r of view.requests) {
      seenR.add(r.key);
      const prev = this.requests.get(r.key);
      const via = prev?.station !== undefined ? viaPoints(prev.station, r.station) : [];
      this.follow(this.requests, r.key, `station:${r.station}`, r.at, via, dtMs, ms, r.station);
    }
    for (const id of [...this.requests.keys()]) if (!seenR.has(id)) this.requests.delete(id);
  }

  private follow<K>(
    map: Map<K, FollowMover>,
    key: K,
    place: string,
    target: Point,
    via: Point[],
    dtMs: number,
    ms: number,
    station?: StationId,
  ): void {
    let e = map.get(key);
    if (!e) {
      e = { m: new Mover(target), place, station };
      map.set(key, e);
      return;
    }
    if (e.place !== place) {
      e.m.moveTo(target, via, ms);
      e.place = place;
    } else if (dist(e.m.target, target) > EPS) {
      // Same place, moved target (the task it rides on walks): keep up.
      e.m.retarget(target);
    }
    e.station = station;
    e.m.advance(dtMs);
  }
}
