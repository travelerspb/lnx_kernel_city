// Scheduler plaza: kernel/sched. One lane per CPU. An idle CPU's token waits
// at the lane head; runnable tasks are listed behind it as queue chips. The
// task itself stays where its code stopped (CITY_MAP rule 2): a chip is a
// place in line, not the task walking here.

import type { WorldCtx, Marker } from '../context';
import type { Label } from '../../engine/text';
import {
  DISTRICTS, ENTITY_LABEL_OFFSET, LAYERS, SIZES, laneBounds, laneLabelPoint, stationPoint,
} from '../layout';
import type { LookId } from '../palette';
import { plot, type District } from './district';

export function create(ctx: WorldCtx): District {
  plot(ctx, 'scheduler');
  let lanes = 0;
  const chips: Array<{ m: Marker; label: Label }> = [];

  const ensureLanes = (n: number) => {
    for (; lanes < n; lanes++) {
      const c = lanes;
      ctx.rect(laneBounds(c), 'lane', LAYERS.district + 0.002);
      const head = stationPoint(`runqueue:${c}`);
      const s = SIZES.stationPad;
      const pad = ctx.rect({ minX: head.x - s, maxX: head.x + s, minZ: head.z - s, maxZ: head.z + s }, 'pad', LAYERS.pad);
      ctx.pickable(pad, { kind: 'station', station: `runqueue:${c}` });
      ctx.label(`runqueue ${c}`, laneLabelPoint(c), { size: SIZES.smallLabel, bold: true });
    }
  };

  return {
    update(state, view) {
      ensureLanes(state.cpus.length);
      while (chips.length < view.queues.length) {
        const m = ctx.marker(SIZES.queueChip);
        const label = ctx.label('', { x: 0, z: 0 }, { size: SIZES.smallLabel, role: 'text.muted', align: 'left' });
        chips.push({ m, label });
      }
      chips.forEach((chip, i) => {
        const q = view.queues[i];
        chip.m.group.visible = q !== undefined;
        chip.label.sprite.visible = q !== undefined;
        if (!q) return;
        const t = view.tasks.find((x) => x.pid === q.pid);
        const look: LookId = t?.mode === 'user' ? 'task.user.runnable' : 'task.kernel.runnable';
        chip.m.setLook(look);
        chip.m.setPos(q.at, LAYERS.chip);
        ctx.picker.add(chip.m.group, { kind: 'task', pid: q.pid });
        chip.label.set(t ? `${t.comm}` : `pid ${q.pid}`);
        const o = ENTITY_LABEL_OFFSET.queueChip;
        chip.label.sprite.position.set(q.at.x + o.x, LAYERS.label, q.at.z + o.z);
      });
    },
  };
}
