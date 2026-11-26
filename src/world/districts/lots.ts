// Kernel city ground and the districts of later stages, drawn as labelled
// empty lots so the map does not reshuffle when they are built.

import type { WorldCtx } from '../context';
import { DISTRICTS, LAYERS, SIZES, ZONES, ZONE_LABELS, zoneLabelPoint, type DistrictId } from '../layout';
import { STATIC, plot, type District } from './district';

export function create(ctx: WorldCtx): District {
  ctx.pickable(ctx.rect(ZONES.kernel, 'zone.kernel', LAYERS.zone), { kind: 'zone', zone: 'kernel' });
  ctx.label(ZONE_LABELS.kernel, zoneLabelPoint(ZONES.kernel), {
    size: SIZES.smallLabel, role: 'text.muted', align: 'left',
  });
  for (const id of Object.keys(DISTRICTS) as DistrictId[]) {
    const d = DISTRICTS[id];
    if (d.stage > 1) plot(ctx, id);
  }
  return STATIC;
}
