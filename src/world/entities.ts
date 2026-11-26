// Moving things: tasks (walkers), CPU tokens, flows (a syscall's work) and
// block requests (cargo). Looks come from view.ts, positions from motion.ts.

import type { Label } from '../engine/text';
import type { WorldCtx, Marker } from './context';
import { ENTITY_LABEL_OFFSET, LAYERS, SIZES, type Point } from './layout';
import { Motion } from './motion';
import type { WorldView } from './view';

interface Item {
  m: Marker;
  label?: Label;
}

export class Entities {
  readonly motion: Motion;
  private readonly tasks = new Map<number, Item>();
  private readonly tokens = new Map<number, Item>();
  private readonly flows = new Map<number, Item>();
  private readonly requests = new Map<string, Item>();

  constructor(
    private readonly ctx: WorldCtx,
    moveMs?: number,
  ) {
    this.motion = new Motion(moveMs === undefined ? {} : { moveMs });
  }

  reset(view: WorldView): void {
    this.motion.reset(view);
    this.draw(view);
  }

  update(view: WorldView, dtMs: number): void {
    this.motion.step(view, dtMs);
    this.draw(view);
  }

  taskPos(pid: number): Point | undefined {
    return this.motion.taskPos(pid);
  }

  flowPos(id: number): Point | undefined {
    return this.motion.flows.get(id)?.m.pos;
  }

  private item<K>(map: Map<K, Item>, key: K, size: number, withLabel: boolean): Item {
    let it = map.get(key);
    if (!it) {
      it = { m: this.ctx.marker(size) };
      if (withLabel) it.label = this.ctx.label('', { x: 0, z: 0 }, { size: SIZES.smallLabel, bold: true });
      map.set(key, it);
    }
    return it;
  }

  private sweep<K>(map: Map<K, Item>, live: Set<K>): void {
    for (const [k, it] of map) {
      if (live.has(k)) continue;
      this.ctx.picker.remove(it.m.group);
      it.m.group.removeFromParent();
      if (it.label) this.ctx.dropLabel(it.label);
      map.delete(k);
    }
  }

  private draw(view: WorldView): void {
    const mo = this.motion;

    const liveT = new Set<number>();
    for (const t of view.tasks) {
      liveT.add(t.pid);
      const it = this.item(this.tasks, t.pid, SIZES.task, true);
      it.m.setLook(t.look);
      const p = mo.taskPos(t.pid) ?? t.at;
      it.m.setPos(p, LAYERS.task);
      this.ctx.pickable(it.m.group, { kind: 'task', pid: t.pid });
      const o = ENTITY_LABEL_OFFSET.task;
      it.label!.set(t.comm);
      it.label!.sprite.position.set(p.x + o.x, LAYERS.label, p.z + o.z);
    }
    this.sweep(this.tasks, liveT);

    const liveK = new Set<number>();
    for (const k of view.tokens) {
      liveK.add(k.cpu);
      const it = this.item(this.tokens, k.cpu, SIZES.token, false);
      it.m.setLook(k.look);
      it.m.setPos(mo.tokens.get(k.cpu)?.m.pos ?? k.at, LAYERS.token);
      this.ctx.pickable(it.m.group, { kind: 'station', station: `cpu:${k.cpu}` });
    }
    this.sweep(this.tokens, liveK);

    const liveF = new Set<number>();
    for (const f of view.flows) {
      liveF.add(f.id);
      const it = this.item(this.flows, f.id, SIZES.flow, true);
      it.m.setLook('flow');
      const p = mo.flows.get(f.id)?.m.pos ?? f.at;
      it.m.setPos(p, LAYERS.flow);
      this.ctx.pickable(it.m.group, { kind: 'flow', flow: f.id });
      // The label names the cargo only while it travels on its own.
      it.label!.sprite.visible = !f.carried;
      const o = ENTITY_LABEL_OFFSET.flow;
      it.label!.set(`${f.name} #${f.id}`);
      it.label!.sprite.position.set(p.x + o.x, LAYERS.label, p.z + o.z);
    }
    this.sweep(this.flows, liveF);

    const liveR = new Set<string>();
    for (const r of view.requests) {
      liveR.add(r.key);
      const it = this.item(this.requests, r.key, SIZES.request, false);
      it.m.setLook(r.look);
      it.m.setPos(mo.requests.get(r.key)?.m.pos ?? r.at, LAYERS.request);
      this.ctx.pickable(it.m.group, r.flow === null ? { kind: 'station', station: r.station } : { kind: 'flow', flow: r.flow });
    }
    this.sweep(this.requests, liveR);
  }
}
