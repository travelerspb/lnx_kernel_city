// The syscall gate: a wall across the map with one opening. The only way
// south for a user task (CITY_MAP rule 1: the task itself walks through).

import type { WorldCtx } from '../context';
import { LAYERS, SIZES, STATION_LABELS, ZONES, ZONE_LABELS, gateWallSegments, zoneLabelPoint } from '../layout';
import { STATIC, type District } from './district';

export function create(ctx: WorldCtx): District {
  ctx.pickable(ctx.rect(ZONES.gate, 'zone.gate', LAYERS.zone), { kind: 'zone', zone: 'gate' });
  for (const s of gateWallSegments()) ctx.strip(s.from, s.to, SIZES.gateWall, 'wall', LAYERS.road + 0.001);
  ctx.label(ZONE_LABELS.gate, zoneLabelPoint(ZONES.gate), { size: SIZES.smallLabel, bold: true, align: 'left' });
  ctx.pad('syscall_gate', STATION_LABELS['syscall_gate']!);
  return STATIC;
}
