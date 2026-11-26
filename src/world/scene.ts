// The world's scene graph without a renderer: districts, entities, the
// last-event marker and selection rings. createWorld() puts it in front of a
// WebGL renderer; tests drive it directly with a fake 2D canvas.

import { Group, Mesh } from 'three';
import { stationOfEvent } from '../core/stations';
import type { KEvent, KernelState, Selection, StationId } from '../core/types';
import type { Picker } from '../engine/picking';
import { sameSelection } from '../engine/picking';
import { disposeShapes, outlineGeometry } from '../engine/shapes';
import { Materials, WorldCtx } from './context';
import * as block from './districts/block';
import type { District } from './districts/district';
import * as drivers from './districts/drivers';
import * as gate from './districts/gate';
import * as hardware from './districts/hardware';
import * as interrupts from './districts/interrupts';
import * as lots from './districts/lots';
import * as pageCache from './districts/pageCache';
import * as roads from './districts/roads';
import * as scheduler from './districts/scheduler';
import * as userland from './districts/userland';
import * as vfs from './districts/vfs';
import { Entities } from './entities';
import { DISTRICTS, LAYERS, SIZES, ZONES, stationPoint, type Bounds, type DistrictId, type Point, type ZoneId } from './layout';
import type { Theme } from './palette';
import { viewOf, type WorldView } from './view';

/** All district modules, in draw-setup order. */
export const DISTRICT_MODULES = [lots, userland, gate, roads, vfs, pageCache, block, drivers, interrupts, scheduler, hardware];

export class WorldScene {
  readonly ctx: WorldCtx;
  readonly entities: Entities;
  readonly districts: District[];
  lastEvent: KEvent | null = null;
  selected: Selection | null = null;
  hovered: Selection | null = null;
  private readonly mats: Materials;
  private readonly pulse: Mesh;
  private readonly selRing: Mesh;
  private readonly hoverRing: Mesh;
  private clock = 0;
  private started = false;
  /** Outlines for a selected or hovered zone or district. */
  private readonly selArea = new AreaOutline();
  private readonly hoverArea = new AreaOutline();

  constructor(picker: Picker, theme: Theme, moveMs?: number) {
    this.mats = new Materials(theme);
    this.ctx = new WorldCtx(this.mats, picker, theme);
    this.districts = DISTRICT_MODULES.map((d) => d.create(this.ctx));
    this.entities = new Entities(this.ctx, moveMs);
    const ring = (r: number, role: 'pulse' | 'highlight', opacity: number) => {
      const m = new Mesh(outlineGeometry('circle', r, 0.3), this.mats.get(role, opacity));
      m.visible = false;
      this.ctx.add(m);
      return m;
    };
    this.pulse = ring(SIZES.stationPad * 1.9, 'pulse', 0.55);
    this.selRing = ring(SIZES.task * 2.3, 'highlight', 1);
    this.hoverRing = ring(SIZES.task * 2.0, 'highlight', 0.45);
  }

  setTheme(t: Theme): void {
    this.ctx.setTheme(t);
  }

  /** Snap every entity to where the state says, forget the last event. */
  reset(view: WorldView): void {
    this.lastEvent = null;
    this.entities.reset(view);
  }

  /** One frame: read state, update districts and entities. Returns the view. */
  frame(state: Readonly<KernelState>, dtMs: number, progress = 0): WorldView {
    this.clock += dtMs;
    const view = viewOf(state);
    for (const d of this.districts) d.update(state, view, this.clock);
    if (!this.started) {
      this.entities.reset(view);
      this.started = true;
    } else {
      this.entities.update(view, dtMs);
    }
    const at = this.lastEvent ? safePoint(stationOfEvent(this.lastEvent)) : null;
    show(this.pulse, at, LAYERS.highlight);
    if (at) this.pulse.scale.setScalar(1 + 0.25 * Math.min(1, Math.max(0, progress)));
    show(this.selRing, this.placeOf(this.selected), LAYERS.highlight + 0.001);
    show(this.hoverRing, sameSelection(this.hovered, this.selected) ? null : this.placeOf(this.hovered), LAYERS.highlight);
    this.selArea.set(this.ctx, areaOf(this.selected), 0.6);
    this.hoverArea.set(this.ctx, sameSelection(this.hovered, this.selected) ? null : areaOf(this.hovered), 0.3);
    return view;
  }

  placeOf(s: Selection | null): Point | null {
    if (!s) return null;
    switch (s.kind) {
      case 'task':
        return this.entities.taskPos(s.pid) ?? null;
      case 'flow':
        return this.entities.flowPos(s.flow) ?? null;
      case 'station':
        return safePoint(s.station);
      case 'event':
      case 'zone':
      case 'district':
      case 'info':
        return null;
    }
  }

  dispose(): void {
    this.ctx.dispose();
    this.mats.dispose();
    disposeShapes();
  }
}

/** Bounds of a selected zone or district, for an outline. */
export function areaOf(s: Selection | null): Bounds | null {
  if (s?.kind === 'zone') return ZONES[s.zone as ZoneId] ?? null;
  if (s?.kind === 'district') return DISTRICTS[s.district as DistrictId] ?? null;
  return null;
}

/** A highlight frame around an area, rebuilt only when the area changes. */
class AreaOutline {
  private group: Group | null = null;
  private key = '';

  set(ctx: WorldCtx, b: Bounds | null, width: number): void {
    const key = b ? `${b.minX},${b.maxX},${b.minZ},${b.maxZ}` : '';
    if (key === this.key) return;
    this.key = key;
    this.group?.removeFromParent();
    this.group = b ? ctx.frame(b, 'highlight', width, LAYERS.highlight) : null;
  }
}

function show(m: Mesh, p: Point | null, layer: number): void {
  m.visible = p !== null;
  if (p) m.position.set(p.x, layer, p.z);
}

export function safePoint(s: StationId): Point | null {
  try {
    return stationPoint(s);
  } catch {
    return null;
  }
}
