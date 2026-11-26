// VFS quarter: fs/ (vfs_read) and the ext4 filesystem.

import type { WorldCtx } from '../context';
import { DISTRICTS, STATION_LABELS } from '../layout';
import { STATIC, plot, type District } from './district';

export function create(ctx: WorldCtx): District {
  plot(ctx, 'vfs');
  ctx.pad('vfs', STATION_LABELS['vfs']!);
  ctx.pad('fs:ext4', STATION_LABELS['fs:ext4']!);
  return STATIC;
}
