// Driver row: drivers/. One building per bound driver, facing its device.

import type { WorldCtx } from '../context';
import { DISTRICTS, STATION_LABELS } from '../layout';
import { STATIC, plot, type District } from './district';

export function create(ctx: WorldCtx): District {
  plot(ctx, 'drivers');
  ctx.pad('driver:virtio_blk', STATION_LABELS['driver:virtio_blk']!);
  return STATIC;
}
