// Page cache warehouse: mm/filemap.c. Shelves hold one tile per page of
// each file: absent (hollow), locked for I/O (cross), up to date (dot).

import type { WorldCtx, Marker } from '../context';
import { DISTRICTS, LAYERS, SIZES, STATION_LABELS, shelfLabelPoint } from '../layout';
import { plot, type District } from './district';

export function create(ctx: WorldCtx): District {
  plot(ctx, 'page_cache');
  ctx.pad('page_cache', STATION_LABELS['page_cache']!);
  const tiles = new Map<string, Marker>();
  const rows = new Set<number>();
  return {
    update(_state, view) {
      view.files.forEach((f, row) => {
        if (rows.has(row)) return;
        rows.add(row);
        ctx.label(`${f.path} (ino ${f.ino})`, shelfLabelPoint(row), { size: SIZES.smallLabel * 0.8, role: 'text.muted', align: 'left' });
      });
      for (const p of view.pages) {
        const key = `${p.ino}:${p.index}`;
        let m = tiles.get(key);
        if (!m) {
          m = ctx.marker(SIZES.page);
          m.setPos(p.at, LAYERS.shelf);
          ctx.pickable(m.group, { kind: 'station', station: 'page_cache' });
          tiles.set(key, m);
        }
        m.setLook(p.look);
      }
    },
  };
}
