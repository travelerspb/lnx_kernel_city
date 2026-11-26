// Block depot: block/. Requests queue here before dispatch; the request
// cargo itself is drawn by the entity layer.

import type { WorldCtx } from '../context';
import { DISTRICTS, STATION_LABELS } from '../layout';
import { STATIC, plot, type District } from './district';

export function create(ctx: WorldCtx): District {
  plot(ctx, 'block');
  ctx.pad('block', STATION_LABELS['block']!);
  return STATIC;
}
