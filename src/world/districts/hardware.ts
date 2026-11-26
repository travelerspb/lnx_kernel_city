// Hardware coast: CPU cores and the disk. Each core shows the context its
// CPU is in. Later hardware (RAM, NIC, timer, keyboard) is an empty lot.

import type { WorldCtx, Marker } from '../context';
import {
  HARDWARE_LOTS, LAYERS, SIZES, STATION_LABELS, ZONES, ZONE_LABELS, coreLabelPoint, labelPoint, zoneLabelPoint,
} from '../layout';
import type { District } from './district';

export function create(ctx: WorldCtx): District {
  ctx.pickable(ctx.rect(ZONES.hardware, 'zone.hardware', LAYERS.zone), { kind: 'zone', zone: 'hardware' });
  ctx.label(ZONE_LABELS.hardware, zoneLabelPoint(ZONES.hardware), { size: SIZES.label, bold: true, align: 'left' });
  for (const lot of HARDWARE_LOTS) {
    ctx.rect(lot, 'lot', LAYERS.district);
    ctx.frame(lot, 'lot.border', 0.2, LAYERS.district + 0.001);
    ctx.label(`${lot.label}\nstage ${lot.stage}`, labelPoint(lot), { size: SIZES.smallLabel, role: 'text.muted', align: 'left' });
  }
  ctx.pad('device:vda', STATION_LABELS['device:vda']!);
  const cores: Marker[] = [];
  return {
    update(_state, view) {
      for (const c of view.cores) {
        let m = cores[c.cpu];
        if (!m) {
          m = ctx.marker(SIZES.core);
          m.setPos(c.at, LAYERS.pad);
          ctx.pickable(m.group, { kind: 'station', station: `cpu:${c.cpu}` });
          ctx.label(`CPU ${c.cpu} core`, coreLabelPoint(c.cpu), { size: SIZES.smallLabel, bold: true });
          cores[c.cpu] = m;
        }
        m.setLook(c.look);
      }
    },
  };
}
