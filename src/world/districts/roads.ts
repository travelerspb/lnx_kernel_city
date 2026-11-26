// Streets between adjacent stations (layout.ROUTES).

import type { WorldCtx } from '../context';
import { LAYERS, ROUTES, SIZES, stationPoint } from '../layout';
import { STATIC, type District } from './district';

export function create(ctx: WorldCtx): District {
  for (const [a, b] of ROUTES) {
    if (a === 'user' || b === 'user') continue; // houses draw their own roads
    ctx.strip(stationPoint(a), stationPoint(b), SIZES.road, 'road', LAYERS.road);
  }
  return STATIC;
}
