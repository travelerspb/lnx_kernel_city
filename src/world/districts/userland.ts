// User Code (userland): one house per user task, with a road to the gate. Houses are
// added when a user task first appears.

import type { WorldCtx } from '../context';
import {
  LAYERS, SIZES, ZONES, ZONE_LABELS, homeRoad, userHomeBounds, userHomeLabelPoint, zoneLabelPoint,
} from '../layout';
import type { District } from './district';

export function create(ctx: WorldCtx): District {
  ctx.pickable(ctx.rect(ZONES.userland, 'zone.userland', LAYERS.zone), { kind: 'zone', zone: 'userland' });
  ctx.label(ZONE_LABELS.userland, zoneLabelPoint(ZONES.userland), { size: SIZES.label, bold: true, align: 'left' });
  const houses = new Map<number, number>();
  return {
    update(_state, view) {
      let slot = 0;
      for (const t of view.tasks) {
        if (t.kind !== 'user') continue;
        if (!houses.has(t.pid)) {
          houses.set(t.pid, slot);
          const b = userHomeBounds(slot);
          const [a, g] = homeRoad(slot);
          ctx.strip(a!, g!, SIZES.road, 'road', LAYERS.road);
          ctx.pickable(ctx.rect(b, 'home', LAYERS.district), { kind: 'task', pid: t.pid });
          ctx.frame(b, 'district.border', 0.3, LAYERS.district + 0.001);
          ctx.label(`${t.comm} (${t.pid})`, userHomeLabelPoint(slot), { size: SIZES.smallLabel, role: 'text.muted' });
        }
        slot++;
      }
    },
  };
}
