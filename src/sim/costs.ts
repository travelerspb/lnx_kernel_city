// Latencies of the synthetic model, in nanoseconds.
//
// EVERY NUMBER HERE IS ILLUSTRATIVE. None of them was measured. They are
// chosen so that the order of events is the order in evidence/read-path.md
// and the proportions look plausible (a function call is ~100 ns, a VM exit
// is ~1 µs, a virtio-blk read is ~100 µs). A real trace (Stage 6) replaces
// them.

import type { Rng } from '../core/rng';

export const COSTS = {
  /** Gap between nested function entries in process context. Illustrative. */
  FN_CALL_NS: 100,
  /** Gap between nested function returns. Illustrative. */
  FN_RETURN_NS: 80,
  /** syscall instruction to the sys_enter tracepoint. Illustrative. */
  SYSCALL_ENTRY_NS: 150,
  /** Last function return to the sys_exit tracepoint. Illustrative. */
  SYSCALL_EXIT_NS: 150,
  /** Page cache xarray walk under RCU. Illustrative. */
  PAGE_CACHE_LOOKUP_NS: 200,
  /** Folio allocation from the page allocator. Illustrative. */
  PAGE_ALLOC_NS: 300,
  /** memcg charge, lock and xarray insert of a folio. Illustrative. */
  PAGE_CACHE_INSERT_NS: 250,
  /** ext4 block mapping and bio construction. Illustrative. */
  BIO_BUILD_NS: 300,
  /** Request allocation and plug insert in blk_mq_submit_bio. Illustrative. */
  BLOCK_QUEUE_NS: 200,
  /** mq-deadline insert, shown as one event. Illustrative. */
  SCHED_INSERT_NS: 150,
  /** virtblk_prep_rq: command and scatter list. Illustrative. */
  DRIVER_PREP_NS: 200,
  /** Notify register write (a VM exit on a hypervisor). Illustrative. */
  NOTIFY_NS: 1_000,
  /** Waiter setup in folio_wait_bit_common before schedule. Illustrative. */
  WAIT_SETUP_NS: 200,
  /** __schedule pick and switch. Illustrative. */
  CONTEXT_SWITCH_NS: 300,
  /** Device read of one 4 KiB page, before jitter. Illustrative. */
  DEVICE_READ_NS: 150_000,
  /** Relative jitter on the device read: +/- this fraction, seeded. Illustrative. */
  DEVICE_JITTER: 0.15,
  /** Used-ring update to irq_handler_entry (MSI-X delivery, injection). Illustrative. */
  IRQ_DELIVERY_NS: 1_500,
  /** Step inside the hardirq or softirq handler chain. Illustrative. */
  HANDLER_STEP_NS: 100,
  /** irq_exit to softirq_entry. Illustrative. */
  SOFTIRQ_ENTRY_NS: 200,
  /** try_to_wake_up to ttwu_do_wakeup on the waking CPU. Illustrative. */
  WAKE_NS: 150,
  /** Wake-list hand-over to a remote idle CPU (IPI or polling idle). Illustrative. */
  WAKE_IPI_NS: 2_000,
  /** Wakeup to the target CPU's reschedule. Illustrative. */
  RESCHED_NS: 1_000,
  /** copy_page_to_iter of 4 KiB. Illustrative. */
  COPY_TO_USER_NS: 400,
} as const;

/** Device read latency with small seeded jitter. Illustrative. */
export function deviceLatency(rng: Rng): number {
  const j = COSTS.DEVICE_JITTER;
  return Math.round(COSTS.DEVICE_READ_NS * rng.range(1 - j, 1 + j));
}
