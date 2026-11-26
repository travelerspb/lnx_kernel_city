# Stage 1 events: tracepoints, probes and synthetic events

Kernel `v6.18` (commit `7d0a66e`). Read on 2026-11-25 from a sparse clone of
the tag. For each tier `T` event: the header that defines it, the trace
system it appears under in tracefs, the place that fires it on our path, and
its fields. Field names are the kernel's `TP_STRUCT__entry` names. For tier
`P` events: the function to probe. For tier `S`: what the device does and
which driver function marks the edge.

Headings use only lower case letters, digits and hyphens, so the anchor is the
heading text under any slug rule.

## Mapping notes

- The envelope already has `pid` and `cpu`. Where a tracepoint field has the
  same name, the schema renames it:
  - `sched_waking`, `sched_wakeup`: tracepoint `pid` becomes payload
    `wakee`; tracepoint `target_cpu` becomes `targetCpu`. The envelope
    `pid` is the task current on the waking CPU (often the idle task or a
    busy task interrupted by the IRQ), not the wakee.
  - `sched_switch`: `prev_pid`, `prev_state`, `next_pid` become `prevPid`,
    `prevState`, `nextPid`.
- Block events: `dev` is a `dev_t`; `sector` is in 512-byte units;
  `nr_sector` becomes `nrSectors`.
- `sys_enter` and `sys_exit` carry a syscall number (`id`), not a name. The
  schema's `name` is derived from `id` with the architecture's table. On
  x86_64 `read` is 0 and `pread64` is 17
  (`arch/x86/entry/syscalls/syscall_64.tbl`).

## Tier T

## sys-enter

- Kernel: `v6.18`
- Location: `include/trace/events/syscalls.h`, event `sys_enter`
  (`TRACE_SYSTEM raw_syscalls`, so tracefs `raw_syscalls/sys_enter`);
  fired by `syscall_trace_enter` in `kernel/entry/syscall-common.c`
- Status: verified
- Event: `sys_enter`
- Station: `syscall_gate`

Fields: `id` (long, syscall number), `args` (array of 6 unsigned long). Fires
only while the tracepoint is enabled, because enabling it sets the
per-task `SYSCALL_WORK_SYSCALL_TRACEPOINT` flag that sends entry through
`syscall_trace_enter`. The header is `syscalls.h`; `raw_syscalls.h` does not
exist at this tag. Per-syscall events with named arguments
(`syscalls/sys_enter_read` with `fd`, `buf`, `count`) are built by
`kernel/trace/trace_syscalls.c` from the syscall metadata; not checked
further.

## sys-exit

- Kernel: `v6.18`
- Location: `include/trace/events/syscalls.h`, event `sys_exit`
  (`raw_syscalls/sys_exit`); fired by `syscall_exit_work` in
  `kernel/entry/syscall-common.c`
- Status: verified
- Event: `sys_exit`
- Station: `syscall_gate`

Fields: `id` (long), `ret` (long). Schema `ret` maps to `ret`.

## mm-page-alloc

- Kernel: `v6.18`
- Location: `include/trace/events/kmem.h`, event `mm_page_alloc` (`kmem`);
  fired at the end of `__alloc_frozen_pages_noprof` in `mm/page_alloc.c`
- Status: verified
- Event: `mm_page_alloc`
- Station: `page_cache`

Fields: `pfn`, `order`, `gfp_flags`, `migratetype`. On the cold path it fires
once per readahead folio (4 times for the default window; the model shows 1).

## mm-filemap-add-to-page-cache

- Kernel: `v6.18`
- Location: `include/trace/events/filemap.h`, event
  `mm_filemap_add_to_page_cache` (`filemap`), class
  `mm_filemap_op_page_cache`; fired in `__filemap_add_folio`,
  `mm/filemap.c`
- Status: verified
- Event: `mm_filemap_add_to_page_cache`
- Station: `page_cache`

Fields: `pfn`, `i_ino`, `index`, `s_dev`, `order`. Schema `ino` is `i_ino`,
`index` is `index`. The same header also defines `mm_filemap_get_pages`
(fields `i_ino`, `s_dev`, `index`, `last_index`), which fires when
`filemap_get_pages` succeeds, on hits and after misses alike.

## block-bio-queue

- Kernel: `v6.18`
- Location: `include/trace/events/block.h`, event `block_bio_queue`
  (`block`), class `block_bio`; fired in `submit_bio_noacct_nocheck`,
  `block/blk-core.c`
- Status: verified
- Event: `block_bio_queue`
- Station: `block`

Fields: `dev`, `sector`, `nr_sector`, `rwbs`, `comm`.

## block-rq-insert

- Kernel: `v6.18`
- Location: `include/trace/events/block.h`, event `block_rq_insert`, class
  `block_rq`; fired in `dd_insert_request` (`block/mq-deadline.c`) on our
  path; also in `blk_mq_insert_request`, `blk_mq_insert_requests`
  (`block/blk-mq.c`), kyber and bfq
- Status: verified
- Event: `block_rq_insert`
- Station: `block`

Fields: `dev`, `sector`, `nr_sector`, `bytes`, `ioprio`, `rwbs`, `comm`,
`cmd`. Fires with `mq-deadline`, the default for a single-queue
`virtio_blk`. Does not fire with scheduler `none` on an idle queue, the
default for a multi-queue `virtio_blk`. See `read-path.md`, "I/O scheduler
and block-rq-insert".

## block-rq-issue

- Kernel: `v6.18`
- Location: `include/trace/events/block.h`, event `block_rq_issue`, class
  `block_rq`; fired in `blk_mq_start_request` (`block/blk-mq.c`), which
  `virtio_blk` calls from `virtblk_prep_rq` inside `virtio_queue_rq`
- Status: verified
- Event: `block_rq_issue`
- Station: `driver:virtio_blk`

Fields: same as `block_rq_insert`. Ordering: fires after the driver's
`queue_rq` is entered.

## block-rq-complete

- Kernel: `v6.18`
- Location: `include/trace/events/block.h`, event `block_rq_complete`, class
  `block_rq_completion`; fired at the start of `blk_update_request`
  (`block/blk-mq.c`)
- Status: verified
- Event: `block_rq_complete`
- Station: `block`

Fields: `dev`, `sector`, `nr_sector`, `error`, `ioprio`, `rwbs`, `cmd`.
Fires in the completion context: BLOCK softirq with one queue, hardirq with
one queue per CPU.

Other block tracepoints at this tag that fire on the path but are not in the
Stage 1 schema: `block_getrq` (in `blk_mq_submit_bio`), `block_plug` and
`block_unplug`, `block_io_start` and `block_io_done` (I/O accounting, in
`blk_account_io_start` and `blk_account_io_done`), `block_bio_complete` (in
`bio_endio`). `block_io_start`/`block_io_done` describe request accounting,
not the device, so they are not substitutes for `hw_io_*`.

## irq-handler-entry

- Kernel: `v6.18`
- Location: `include/trace/events/irq.h`, event `irq_handler_entry` (`irq`);
  fired in `__handle_irq_event_percpu`, `kernel/irq/handle.c`
- Status: verified
- Event: `irq_handler_entry`
- Station: `irq`

Fields: `irq` (int), `name` (string, the action name). For a per-queue MSI-X
vector the name is the device name and queue name joined by a hyphen
(`vp_find_one_vq_msix` in `drivers/virtio/virtio_pci_common.c`), with queue
names `req.<n>` from `init_vq`, so `virtio<k>-req.0`. With shared vectors it
is `virtio<k>-virtqueues`.

## irq-handler-exit

- Kernel: `v6.18`
- Location: `include/trace/events/irq.h`, event `irq_handler_exit`; fired in
  `__handle_irq_event_percpu`
- Status: verified
- Event: `irq_handler_exit`
- Station: `irq`

Fields: `irq`, `ret` (1 means handled).

## softirq-raise

- Kernel: `v6.18`
- Location: `include/trace/events/irq.h`, event `softirq_raise`, class
  `softirq`; fired in `__raise_softirq_irqoff`, `kernel/softirq.c`
- Status: verified
- Event: `softirq_raise`
- Station: `softirq`

Field: `vec`. BLOCK is 4 in the softirq enum in `include/linux/interrupt.h`
(HI 0, TIMER 1, NET_TX 2, NET_RX 3, BLOCK 4, IRQ_POLL 5, TASKLET 6, SCHED 7,
HRTIMER 8, RCU 9). Raised by `blk_mq_raise_softirq` in hardirq.

## softirq-entry

- Kernel: `v6.18`
- Location: `include/trace/events/irq.h`, event `softirq_entry`; fired in
  `handle_softirqs`, `kernel/softirq.c`
- Status: verified
- Event: `softirq_entry`
- Station: `softirq`

Field: `vec`. Runs on interrupt exit (`irq_exit_rcu`, `__irq_exit_rcu`,
`invoke_softirq`) when softirqs are pending and the CPU is not already in
interrupt context; under heavy load or forced IRQ threading it runs in
`ksoftirqd` instead.

## softirq-exit

- Kernel: `v6.18`
- Location: `include/trace/events/irq.h`, event `softirq_exit`; fired in
  `handle_softirqs`
- Status: verified
- Event: `softirq_exit`
- Station: `softirq`

Field: `vec`.

## sched-waking

- Kernel: `v6.18`
- Location: `include/trace/events/sched.h`, event `sched_waking`, class
  `sched_wakeup_template`; fired in `try_to_wake_up`,
  `kernel/sched/core.c`
- Status: verified
- Event: `sched_waking`
- Station: `runqueue:<target>`

Fields: `comm`, `pid`, `prio`, `target_cpu`. Schema: `pid` to `wakee`,
`target_cpu` to `targetCpu`. Fires on the waking CPU. The class fills
`target_cpu` from `task_cpu(p)`, and `try_to_wake_up` fires `sched_waking`
before `select_task_rq` and `set_task_cpu`. So in `sched_waking`,
`target_cpu` is the CPU the task last ran on, which may differ from where it
is placed. `sched_wakeup` carries the chosen CPU. The model should set
`targetCpu` of `sched_waking` to the reader's previous CPU.

## sched-wakeup

- Kernel: `v6.18`
- Location: `include/trace/events/sched.h`, event `sched_wakeup`, class
  `sched_wakeup_template`; fired in `ttwu_do_wakeup`, `kernel/sched/core.c`
- Status: verified
- Event: `sched_wakeup`
- Station: `runqueue:<target>`

Fields and mapping as `sched_waking`. Fires on the waking CPU, or on the
target CPU when the wakeup went through the remote wake list.

## sched-switch

- Kernel: `v6.18`
- Location: `include/trace/events/sched.h`, event `sched_switch`; fired in
  `__schedule`, `kernel/sched/core.c`
- Status: verified
- Event: `sched_switch`
- Station: `cpu:<cpu>`

Fields: `prev_comm`, `prev_pid`, `prev_prio`, `prev_state`, `next_comm`,
`next_pid`, `next_prio`. The reader sleeps in TASK_KILLABLE, which includes
TASK_UNINTERRUPTIBLE, so `prev_state` shows `D`.

## Tier P

Probeability notes: fentry and kprobes need a real, non-inlined, not
blacklisted function. `static` functions may be inlined by the compiler;
whether a given one survives in a build is not verified here. Exported
functions and functions installed in an operations table keep a body.

## func-entry

- Kernel: `v6.18`
- Location: one probe per function named in `read-path.md`
- Status: verified
- Event: `func_entry`
- Station: by function, `src/core/stations.ts`

Attach fentry (or kprobe) to the function in `fn`. Safe targets (exported or
in an ops table): `ksys_read`, `vfs_read`, `ext4_file_read_iter`,
`generic_file_read_iter`, `filemap_read`, `page_cache_sync_ra`,
`ext4_readahead`, `ext4_mpage_readpages`, `submit_bio`,
`submit_bio_noacct`, `blk_mq_submit_bio`, `virtio_queue_rq`,
`virtqueue_notify`, `vring_interrupt`, `virtblk_done`,
`blk_mq_complete_request`, `bio_endio`, `folio_end_read`, `io_schedule`,
`copy_page_to_iter`. Not probeable: `entry_SYSCALL_64` (assembly),
`do_syscall_64` (`noinstr`). Possibly inlined: `new_sync_read`,
`filemap_get_pages`, `filemap_get_read_batch`, `folio_wait_bit_common`
(declared `static inline`).

## func-exit

- Kernel: `v6.18`
- Location: as `func-entry`
- Status: verified
- Event: `func_exit`
- Station: by function

Attach fexit (or kretprobe) to the same function; `ret` is its return value.

## page-cache-lookup

- Kernel: `v6.18`
- Location: `mm/filemap.c`, function `filemap_get_read_batch` (the lookup),
  inside `filemap_get_pages`
- Status: verified
- Event: `page_cache_lookup`
- Station: `page_cache`

The lookup function is static and its result is a filled batch, not a flag,
so a direct probe is not reliable. Recommended derivation: a miss is the
`readahead/page_cache_sync_ra` tracepoint
(`include/trace/events/readahead.h`, fields `i_ino`, `s_dev`, `index`,
`order`, `size`, `async_size`, `ra_pages`, `mmap_miss`, `prev_pos`,
`req_count`), fired at the start of `page_cache_sync_ra`, which
`filemap_get_pages` calls only when the lookup found nothing. A hit is a
`filemap/mm_filemap_get_pages` event for the index with no
`page_cache_sync_ra` before it in the same `read`. This gives `ino` and
`index` from tracepoint fields. A kprobe on `page_cache_sync_ra` works too.

## folio-end-read

- Kernel: `v6.18`
- Location: `mm/filemap.c`, function `folio_end_read` (exported), called
  from `__read_end_io` in `fs/ext4/readpage.c`
- Status: verified
- Event: `folio_end_read`
- Station: `page_cache`

Probe `folio_end_read` entry. `ok` is its second argument (success). `ino`
and `index` come from the folio argument (`folio->mapping->host->i_ino`,
`folio->index`), so a BTF-aware probe is needed. Context: completion
context, BLOCK softirq with one queue or hardirq with one queue per CPU;
workqueue if fscrypt or fs-verity is active. Fires once per folio in the bio
(4 times on the default cold read).

## copy-to-user

- Kernel: `v6.18`
- Location: `lib/iov_iter.c`, function `copy_page_to_iter` (exported),
  called through `copy_folio_to_iter` from `filemap_read`
- Status: verified
- Event: `copy_to_user`
- Station: `syscall_gate`

Probe `copy_page_to_iter`; `bytes` is its third argument, and the fexit
return value is the bytes actually copied. `_copy_to_iter` (exported) is an
alternative but is also used by other paths. The kernel's own
`copy_to_user` and `raw_copy_to_user` are inline here and cannot be probed.
The event name `copy_to_user` is fine as a label; it does not name a
probeable function.

## Tier S

## hw-io-start

- Kernel: `v6.18`
- Location: `drivers/virtio/virtio_ring.c`, function `virtqueue_notify`,
  called from `virtio_queue_rq` in `drivers/block/virtio_blk.c`
- Status: verified
- Event: `hw_io_start`
- Station: `device:vda`

No kernel hook sees the device start. The last kernel point is the notify:
`virtio_queue_rq` adds the request's buffers (header, data, status byte) to
the virtqueue's available ring and, if the device has not suppressed
notifications, `virtqueue_notify` writes to the device's notify register. The
device (the hypervisor's virtio-blk back end) then reads the descriptors and
performs the read. If notifications are suppressed, the device is already
polling the ring and picks the request up without a notify. A trace can
approximate the start with `block_rq_issue` or a probe on
`virtqueue_notify`.

## hw-io-done

- Kernel: `v6.18`
- Location: `drivers/virtio/virtio_ring.c`, function `vring_interrupt`, and
  `drivers/block/virtio_blk.c`, function `virtblk_done`
- Status: verified
- Event: `hw_io_done`
- Station: `device:vda`

The device writes the data into the guest pages, sets the status byte, puts
the descriptor chain on the used ring and raises the queue's MSI-X interrupt.
The first kernel point is `vring_interrupt`, which finds the new used buffer
and calls `virtblk_done`, which takes it off the ring with
`virtqueue_get_buf`. A trace can approximate the end with
`irq_handler_entry` for the queue's vector.
