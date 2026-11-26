// Event type and kernel function name to station. This table, together with
// world/layout.ts, links the kernel model to the picture.
//
// Function names come from evidence/read-path.md (WP1, verified at v6.18). Each one needs an entry in
// evidence/index.json under "functions"; the coverage test checks this.

import type { KEvent, StationId } from './types';

export const FUNCTION_STATIONS: Readonly<Record<string, StationId>> = {
  // Syscall entry and exit. do_syscall_64 is noinstr and cannot be probed;
  // it is listed for the inspector, not as a probe target.
  entry_SYSCALL_64: 'syscall_gate',
  do_syscall_64: 'syscall_gate',
  x64_sys_call: 'syscall_gate',
  syscall_exit_work: 'syscall_gate',
  ksys_read: 'vfs',
  ksys_pread64: 'vfs',
  vfs_read: 'vfs',
  new_sync_read: 'vfs',
  // Filesystem and page cache
  ext4_file_read_iter: 'fs:ext4',
  generic_file_read_iter: 'page_cache',
  filemap_read: 'page_cache',
  filemap_get_pages: 'page_cache',
  filemap_get_read_batch: 'page_cache',
  filemap_update_page: 'page_cache',
  filemap_alloc_folio: 'page_cache',
  filemap_add_folio: 'page_cache',
  page_cache_sync_ra: 'page_cache',
  page_cache_ra_order: 'page_cache',
  read_pages: 'page_cache',
  ext4_readahead: 'fs:ext4',
  ext4_mpage_readpages: 'fs:ext4',
  mpage_end_io: 'fs:ext4',
  folio_wait_bit_common: 'page_cache',
  folio_end_read: 'page_cache',
  folio_wake_bit: 'page_cache',
  copy_page_to_iter: 'syscall_gate',
  // Block layer
  submit_bio: 'block',
  submit_bio_noacct: 'block',
  submit_bio_noacct_nocheck: 'block',
  blk_mq_submit_bio: 'block',
  blk_finish_plug: 'block',
  blk_mq_flush_plug_list: 'block',
  dd_insert_request: 'block',
  blk_mq_run_hw_queue: 'block',
  blk_mq_dispatch_rq_list: 'block',
  blk_mq_complete_request: 'block',
  blk_mq_raise_softirq: 'block',
  blk_done_softirq: 'softirq',
  blk_update_request: 'block',
  blk_mq_end_request: 'block',
  bio_endio: 'block',
  // Driver
  virtio_queue_rq: 'driver:virtio_blk',
  blk_mq_start_request: 'driver:virtio_blk',
  virtqueue_notify: 'driver:virtio_blk',
  virtblk_done: 'driver:virtio_blk',
  virtblk_request_done: 'driver:virtio_blk',
  // Interrupt
  vring_interrupt: 'irq',
  // Scheduler. These run on the CPU, so they do not move a task or a request.
};

export function stationOfFunction(fn: string): StationId | undefined {
  return FUNCTION_STATIONS[fn];
}

/** Where an event happens, for drawing a marker. */
export function stationOfEvent(ev: KEvent): StationId {
  switch (ev.type) {
    case 'sys_enter':
    case 'sys_exit':
    case 'copy_to_user':
      return 'syscall_gate';
    case 'func_entry':
    case 'func_exit':
      return stationOfFunction(ev.fn) ?? 'vfs';
    case 'page_cache_lookup':
    case 'mm_page_alloc':
    case 'mm_filemap_add_to_page_cache':
    case 'folio_end_read':
      return 'page_cache';
    case 'block_bio_queue':
    case 'block_rq_insert':
    case 'block_rq_complete':
      return 'block';
    case 'block_rq_issue':
      return 'driver:virtio_blk';
    case 'hw_io_start':
    case 'hw_io_done':
      return `device:${ev.dev}` as StationId;
    case 'irq_handler_entry':
    case 'irq_handler_exit':
      return 'irq';
    case 'softirq_raise':
    case 'softirq_entry':
    case 'softirq_exit':
      return 'softirq';
    case 'sched_waking':
    case 'sched_wakeup':
      return `runqueue:${ev.targetCpu}`;
    case 'sched_switch':
      return `cpu:${ev.cpu}`;
  }
}

/** All fixed stations of Stage 1, plus per-CPU ones for `ncpu` CPUs. */
export function allStations(ncpu: number): StationId[] {
  const fixed: StationId[] = [
    'user', 'syscall_gate', 'vfs', 'fs:ext4', 'page_cache', 'block',
    'driver:virtio_blk', 'device:vda', 'irq', 'softirq',
  ];
  for (let i = 0; i < ncpu; i++) fixed.push(`runqueue:${i}`, `cpu:${i}`);
  return fixed;
}
