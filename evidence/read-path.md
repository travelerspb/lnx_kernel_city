# The `read()` path at `v6.18`: cold and warm

Kernel `v6.18` (commit `7d0a66e`), x86_64, ext4 on `/dev/vda` served by
`virtio_blk` over virtio-pci. Read on 2026-11-25 from a sparse clone of the
tag. Every step below names a file and a function at that tag. Behaviour is
described in our own words; no kernel source is copied here.

Headings use only lower case letters, digits and hyphens, so the anchor is the
heading text under any slug rule. Kernel names with underscores appear in the
"Location" line.

## Configuration assumed

The chain depends on three settings. The model uses the first column.

| Setting | Model (Stage 1) | Other common value | What changes |
|---|---|---|---|
| virtio_blk request queues | 1 | one per CPU | Scheduler, `block_rq_insert`, softirq use |
| I/O scheduler | `mq-deadline` (kernel default for 1 queue) | `none` (default for several queues) | `block_rq_insert` fires only with a scheduler or a busy queue |
| Interrupt CPU | any CPU in the single vector's mask | the submitting CPU (per-queue vector) | Where the hardirq and softirq run |

Why: `virtio_blk` asks the device how many queues it has (`init_vq` in
`drivers/block/virtio_blk.c`) and caps the number by the
`num_request_queues` module parameter and the number of possible CPUs. The
default scheduler is chosen in `elevator_set_default` (`block/elevator.c`):
`mq-deadline` when the queue has one hardware context or shared tags, `none`
otherwise. `virtio_blk` does not opt out of a default scheduler (no
`BLK_MQ_F_NO_SCHED_BY_DEFAULT` in its tag set). How many queues a given
hypervisor exposes is a hypervisor setting, not kernel code; it is not
verified here.

The single-queue setup is the one in which every Stage 1 event type
(including `block_rq_insert` and the BLOCK softirq) fires, so the model uses
it. The multi-queue differences are listed under each step.

Note for the scenario: `docs/stage-1/README.md` lists "the I/O scheduler" as
out of scope. With one queue the kernel does use `mq-deadline` on this path.
The model shows the insert as one event and skips the scheduler's internals.

## Cold read, in order

Station names are from `src/core/stations.ts`. "Event" is the schema event
type the step maps to. Rows without an event are context for WP2.

| # | Function | File | What happens | Event | Station |
|---|---|---|---|---|---|
| 1 | `entry_SYSCALL_64` | `arch/x86/entry/entry_64.S` | `syscall` instruction lands here; saves registers, calls `do_syscall_64` | | `syscall_gate` |
| 2 | `do_syscall_64` | `arch/x86/entry/syscall_64.c` | Entry work, including the `sys_enter` tracepoint via `syscall_trace_enter` | `sys_enter` | `syscall_gate` |
| 3 | `x64_sys_call` | `arch/x86/entry/syscall_64.c` | Table switch to `__x64_sys_read` (`SYSCALL_DEFINE3(read)` in `fs/read_write.c`) | `func_entry` | `syscall_gate` |
| 4 | `ksys_read` | `fs/read_write.c` | Looks up the file, takes the position, calls `vfs_read` | `func_entry` | `vfs` |
| 5 | `vfs_read` | `fs/read_write.c` | Checks mode and range; ext4 has no `.read`, so goes to `new_sync_read` | `func_entry` | `vfs` |
| 6 | `new_sync_read` | `fs/read_write.c` | Wraps the user buffer in a kiocb and iov_iter; calls `->read_iter` | `func_entry` | `vfs` |
| 7 | `ext4_file_read_iter` | `fs/ext4/file.c` | Not DAX, not O_DIRECT: calls `generic_file_read_iter` | `func_entry` | `fs:ext4` |
| 8 | `generic_file_read_iter` | `mm/filemap.c` | Buffered read: calls `filemap_read` | `func_entry` | `page_cache` |
| 9 | `filemap_read` | `mm/filemap.c` | Loop: get folios, copy to user | `func_entry` | `page_cache` |
| 10 | `filemap_get_pages` | `mm/filemap.c` | Looks up folios for the range | `func_entry` | `page_cache` |
| 11 | `filemap_get_read_batch` | `mm/filemap.c` | Page cache lookup under RCU; finds nothing | `page_cache_lookup` (hit false) | `page_cache` |
| 12 | `page_cache_sync_ra` | `mm/readahead.c` | Miss: synchronous readahead. At offset 0 sets a 4-page window, 3 of them async | `func_entry` | `page_cache` |
| 13 | `page_cache_ra_order` | `mm/readahead.c` | Allocates and inserts the window's folios (order 0 here) | | `page_cache` |
| 14 | `filemap_alloc_folio` | `mm/filemap.c` | Allocates a folio from the page allocator, once per page | `mm_page_alloc` | `page_cache` |
| 15 | `filemap_add_folio` | `mm/filemap.c` | Charges, locks and inserts the folio into the mapping | `mm_filemap_add_to_page_cache` | `page_cache` |
| 16 | `read_pages` | `mm/readahead.c` | Starts a block plug, calls `->readahead` | | `page_cache` |
| 17 | `ext4_readahead` | `fs/ext4/inode.c` | Calls `ext4_mpage_readpages` | `func_entry` | `fs:ext4` |
| 18 | `ext4_mpage_readpages` | `fs/ext4/readpage.c` | Maps blocks, builds one read bio for contiguous blocks, end_io `mpage_end_io` | `func_entry` | `fs:ext4` |
| 19 | `submit_bio` | `block/blk-core.c` | Accounts the read, calls `submit_bio_noacct` | `func_entry` | `block` |
| 20 | `submit_bio_noacct` | `block/blk-core.c` | Checks, then `submit_bio_noacct_nocheck` | `func_entry` | `block` |
| 21 | `submit_bio_noacct_nocheck` | `block/blk-core.c` | Fires `block_bio_queue`, then `__submit_bio` | `block_bio_queue` | `block` |
| 22 | `blk_mq_submit_bio` | `block/blk-mq.c` | Tries merge, gets a request, adds it to the task's plug | `func_entry` | `block` |
| 23 | `blk_finish_plug` | `block/blk-core.c` | Called by `read_pages`; flushes the plug | | `block` |
| 24 | `blk_mq_flush_plug_list` | `block/blk-mq.c` | With a scheduler, hands the list to `blk_mq_dispatch_list` | | `block` |
| 25 | `dd_insert_request` | `block/mq-deadline.c` | Scheduler insert; fires `block_rq_insert` | `block_rq_insert` | `block` |
| 26 | `blk_mq_run_hw_queue` | `block/blk-mq.c` | Runs the queue synchronously on this CPU | | `block` |
| 27 | `blk_mq_dispatch_rq_list` | `block/blk-mq.c` | Pulls from the scheduler, calls the driver's `queue_rq` | | `block` |
| 28 | `virtio_queue_rq` | `drivers/block/virtio_blk.c` | Builds the virtio command | `func_entry` | `driver:virtio_blk` |
| 29 | `blk_mq_start_request` | `block/blk-mq.c` | Called from `virtblk_prep_rq` inside step 28; fires `block_rq_issue` | `block_rq_issue` | `driver:virtio_blk` |
| 30 | `virtqueue_notify` | `drivers/virtio/virtio_ring.c` | After adding the buffers and `virtqueue_kick_prepare`, notifies the device | `hw_io_start` (S) | `device:vda` |
| 31 | `filemap_get_read_batch` | `mm/filemap.c` | Back in `filemap_get_pages`: finds folio 0, locked and not up to date | | `page_cache` |
| 32 | `filemap_update_page` | `mm/filemap.c` | Cannot take the folio lock (readahead holds it); waits | | `page_cache` |
| 33 | `folio_wait_bit_common` | `mm/filemap.c` | Via `folio_put_wait_locked`: queues a waiter, sets TASK_KILLABLE, sleeps | `func_entry` | `page_cache` |
| 34 | `io_schedule` | `kernel/sched/core.c` | Marks iowait, calls `schedule` | | `cpu:<n>` |
| 35 | `__schedule` | `kernel/sched/core.c` | Picks the next task; `reader` leaves in state D | `sched_switch` | `cpu:<n>` |

Completion, single queue:

| # | Function | File | What happens | Event | Station |
|---|---|---|---|---|---|
| 36 | (device) | | Device reads the blocks and puts the buffer on the used ring | `hw_io_done` (S) | `device:vda` |
| 37 | `__handle_irq_event_percpu` | `kernel/irq/handle.c` | MSI-X arrives: `common_interrupt` (`arch/x86/kernel/irq.c`), `handle_edge_irq`, then the action | `irq_handler_entry` | `irq` |
| 38 | `vring_interrupt` | `drivers/virtio/virtio_ring.c` | Sees used buffers, calls the queue callback | `func_entry` | `irq` |
| 39 | `virtblk_done` | `drivers/block/virtio_blk.c` | Takes each finished request off the ring, calls `blk_mq_complete_request` | `func_entry` | `driver:virtio_blk` |
| 40 | `blk_mq_complete_request` | `block/blk-mq.c` | Asks `blk_mq_complete_request_remote` whether to defer | `func_entry` | `block` |
| 41 | `blk_mq_raise_softirq` | `block/blk-mq.c` | One hardware queue: queue the request on this CPU's list, raise BLOCK_SOFTIRQ | `softirq_raise` (vec 4) | `softirq` |
| 42 | `__handle_irq_event_percpu` | `kernel/irq/handle.c` | Handler returns IRQ_HANDLED | `irq_handler_exit` | `irq` |
| 43 | `handle_softirqs` | `kernel/softirq.c` | `irq_exit_rcu` sees pending softirqs and runs them | `softirq_entry` (vec 4) | `softirq` |
| 44 | `blk_done_softirq` | `block/blk-mq.c` | Runs `->complete` (`virtblk_request_done`) for each queued request | | `softirq` |
| 45 | `virtblk_request_done` | `drivers/block/virtio_blk.c` | Reads status, unmaps, calls `blk_mq_end_request` | | `driver:virtio_blk` |
| 46 | `blk_update_request` | `block/blk-mq.c` | Fires `block_rq_complete`, ends each bio | `block_rq_complete` | `block` |
| 47 | `bio_endio` | `block/bio.c` | Calls the bio's end_io | `func_entry` | `block` |
| 48 | `mpage_end_io` | `fs/ext4/readpage.c` | No decrypt or verity: calls `folio_end_read` for each folio | | `fs:ext4` |
| 49 | `folio_end_read` | `mm/filemap.c` | Sets up to date, clears locked; wakes waiters if any | `folio_end_read` | `page_cache` |
| 50 | `folio_wake_bit` | `mm/filemap.c` | Walks the hashed wait queue; `wake_page_function` wakes `reader` | | `page_cache` |
| 51 | `try_to_wake_up` | `kernel/sched/core.c` | Fires `sched_waking`, picks a CPU, queues the task | `sched_waking` | `runqueue:<target>` |
| 52 | `ttwu_do_wakeup` | `kernel/sched/core.c` | Sets running; fires `sched_wakeup` | `sched_wakeup` | `runqueue:<target>` |
| 53 | `handle_softirqs` | `kernel/softirq.c` | BLOCK vector done | `softirq_exit` (vec 4) | `softirq` |
| 54 | `__schedule` | `kernel/sched/core.c` | On the target CPU, `reader` is switched in | `sched_switch` | `cpu:<target>` |

Return:

| # | Function | File | What happens | Event | Station |
|---|---|---|---|---|---|
| 55 | `filemap_get_pages` | `mm/filemap.c` | Wait returned "truncated page"; it retries the lookup and finds folio 0 up to date | `page_cache_lookup` (hit true), optional | `page_cache` |
| 56 | `copy_page_to_iter` | `lib/iov_iter.c` | Via `copy_folio_to_iter` (`include/linux/uio.h`); maps the page and calls `_copy_to_iter`, which ends in `raw_copy_to_user` | `copy_to_user` | `syscall_gate` |
| 57 | `filemap_read` | `mm/filemap.c` | Drops folio references, updates access time and readahead state, returns bytes | `func_exit` | `page_cache` |
| 58 | `syscall_exit_work` | `kernel/entry/syscall-common.c` | Exit work from `do_syscall_64`; fires `sys_exit` | `sys_exit` | `syscall_gate` |

Differences with one queue per CPU (scheduler `none`): at step 24 the plug
holds no scheduler requests, so `blk_mq_dispatch_queue_requests` hands the
list to the driver's `virtio_queue_rqs` batch hook. Steps 25 to 27 disappear
and `block_rq_insert` does not fire. The request still gets `block_rq_issue`
in `virtblk_prep_rq`. At step 41 `blk_mq_complete_request_remote` returns
false and `virtblk_request_done` runs directly inside the hardirq, so there is
no `softirq_raise`, `softirq_entry` or `softirq_exit`; steps 45 to 52 happen
between `irq_handler_entry` and `irq_handler_exit`.

## Warm read, in order

Steps 1 to 10 as above. `filemap_get_read_batch` returns folio 0, up to date
and without the readahead mark, so no I/O starts. `filemap_read` copies with
`copy_page_to_iter` and returns; `sys_exit` fires. Events: `sys_enter`,
`func_entry`/`func_exit` for the VFS chain, `page_cache_lookup` (hit true),
`copy_to_user`, `sys_exit`.

Condition: the warm read must read page 0 again. A plain second `read()` on
the same descriptor starts at offset 4096 (`ksys_read` stores the advanced
position). Page 1 is then in the cache from readahead but carries the
readahead mark, so `filemap_get_pages` calls `filemap_readahead` and starts
asynchronous readahead (`page_cache_async_ra`). The scenario should use
`lseek(fd, 0, SEEK_SET)` before the second `read()`, or `pread64` (which
reaches `vfs_read` through `ksys_pread64`).

## ksys-pread64

- Kernel: `v6.18`
- Location: `fs/read_write.c`, function `ksys_pread64`, called from the
  `pread64` syscall definition in the same file
- Status: verified
- Event: `func_entry` / `func_exit` with `fn: "ksys_pread64"`
- Station: `vfs`

Rejects a negative offset, resolves the descriptor, checks that the file
allows positioned reads, and calls `vfs_read` with a local copy of the
offset. The file position stored in the descriptor is not changed, which is
why the warm read uses it to read page 0 again.

## Readahead on a cold read

Question 2 of the brief. `page_cache_sync_ra` in `mm/readahead.c` is called
on any miss in `filemap_get_pages`. For a read of one page at offset 0 it
takes the "start of file" branch: the window size comes from
`get_init_ra_size(1, max)`, which quadruples small requests, so the window is
4 pages with 3 pages marked async. `max` is the file's `ra_pages`, at least
`VM_READAHEAD_PAGES` (128 KiB, `include/linux/pagemap.h`) per
`blk_apply_bdi_limits` (`block/blk-settings.c`). The window is cut at end of
file. ext4 enables large folios for regular files
(`ext4_should_enable_large_folio`, `fs/ext4/inode.c`), but the sync path sets
`ra->order` to 0 first, so `page_cache_ra_order` allocates four order-0
folios. The folio at index 1 gets the readahead mark. All four go into one
bio if their blocks are contiguous on disk.

Readahead is skipped only when `ra_pages` is 0, the block cgroup is
congested, or the file is `FMODE_RANDOM` (`POSIX_FADV_RANDOM`); then
`force_page_cache_ra` reads just the requested page.

What the model does: it shows one page. It skips the three extra
allocations, inserts and folio completions, and the readahead mark. The bio
is one request either way. If the file is one page long, the kernel also
reads one page.

`filemap_create_folio` (the single-folio path through `->read_folio`, here
`ext4_read_folio`) is used only when readahead added nothing, for example
under memory pressure. It is not on the normal cold path.

## Interrupt and softirq context

Question 3. `virtblk_done` always runs in hardirq context: it is the virtqueue
callback, called by `vring_interrupt`, the MSI-X handler registered per queue
in `vp_find_one_vq_msix` (`drivers/virtio/virtio_pci_common.c`), or by
`vp_vring_interrupt` when vectors are shared. Whether the request's
completion work runs there or in the BLOCK softirq is decided by
`blk_mq_complete_request_remote` (`block/blk-mq.c`):

1. If the hardware queue serves only one CPU and the interrupt is on that
   CPU, or the request is polled: complete inline, in hardirq.
2. Else, if `QUEUE_FLAG_SAME_COMP` is set (default, `QUEUE_FLAG_MQ_DEFAULT`
   in `include/linux/blkdev.h`) and `blk_mq_complete_need_ipi` finds the
   submitting CPU in another cache domain (or `rq_affinity=2`): send an IPI;
   the submitting CPU raises BLOCK_SOFTIRQ and completes there.
3. Else, if the device has one hardware queue: raise BLOCK_SOFTIRQ on this
   CPU (`blk_mq_raise_softirq`).
4. Else complete inline, in hardirq.

With forced IRQ threading (`threadirqs`) the IPI step is skipped and
softirqs may run in `ksoftirqd`; not modelled.

Tracepoint order, single queue, interrupt on a CPU sharing cache with the
submitter: `irq_handler_entry`, `softirq_raise` (vec 4), `irq_handler_exit`,
`softirq_entry` (vec 4), `block_rq_complete`, `folio_end_read`,
`sched_waking`, `sched_wakeup` (or on the target CPU, see below),
`softirq_exit`. BLOCK_SOFTIRQ is vector 4 (`include/linux/interrupt.h`).

## Interrupt CPU and wakeup CPU

Question 4.

Interrupt CPU. `virtio_blk` passes an `irq_affinity` descriptor to
`virtio_find_vqs`; virtio-pci then allocates MSI-X vectors with
`PCI_IRQ_AFFINITY`, one for config and one per request queue, so the kernel
spreads the queue vectors over the CPUs as managed interrupts.
`virtblk_map_queues` maps each CPU to the queue whose vector covers it
(`blk_mq_map_hw_queues`, `block/blk-mq-cpumap.c`). Fixed: with one queue per
CPU, the interrupt for a request comes to the submitting CPU. Depends on
configuration: with one queue, the vector's mask is all CPUs and the x86
vector code picks one effective CPU; which one is not verified. If MSI-X
vectors are not available, virtio-pci falls back to a shared vector or INTx
(`vp_interrupt`). The model picks any CPU other than the reader's.

Wakeup CPU. `try_to_wake_up` calls `select_task_rq`, which for a CFS task
calls `select_task_rq_fair` (`kernel/sched/fair.c`). For a plain wakeup it
considers `wake_affine` (waker CPU against previous CPU) and then
`select_idle_sibling` around the chosen CPU. The result depends on load and
idle state; it is not fixed. In this scenario the reader's previous CPU is
running a busy task, so the result is not predictable from code alone.
`sched_waking` fires on the waking CPU. If the target CPU is remote and
`ttwu_queue_cond` allows it (target idle, or no shared cache), the task goes
on the target's wake list by IPI and `sched_wakeup` fires later on the
target CPU (`sched_ttwu_pending`); otherwise `ttwu_do_wakeup` fires it on the
waking CPU. `sched_wakeup`'s `target_cpu` is the chosen CPU;
`sched_waking`'s is the CPU the task last ran on, because it fires before
the choice (`try_to_wake_up`, and `task_cpu` in the event class).

## I/O scheduler and block-rq-insert

Question 5. `block_rq_insert` fires in these places at `v6.18`:
`blk_mq_insert_request` and `blk_mq_insert_requests` when there is no
scheduler (only reached when direct issue is not possible: queue busy,
stopped, out of tags or budget), and the schedulers' insert hooks
(`dd_insert_request` in `block/mq-deadline.c`, `kyber_insert_requests`,
`bfq_insert_request`). So:

- One queue, `mq-deadline` (default): fires, from `dd_insert_request`.
- Several queues, `none` (default): does not fire on an idle queue. The plug
  is flushed straight to `virtio_queue_rqs`.

The model's single-queue setup keeps `block_rq_insert`.

## Function entries

## entry-syscall-64

- Kernel: `v6.18`
- Location: `arch/x86/entry/entry_64.S`, symbol `entry_SYSCALL_64`
- Status: verified
- Event: none (assembly; not probeable as a function)
- Station: `syscall_gate`

The `syscall` instruction's entry point. It switches to the kernel stack,
saves user registers and calls `do_syscall_64`.

## do-syscall-64

- Kernel: `v6.18`
- Location: `arch/x86/entry/syscall_64.c`, function `do_syscall_64`
- Status: verified
- Event: `sys_enter` and `sys_exit` fire inside it; `func_entry`/`func_exit`
  with `fn: "do_syscall_64"` are model only
- Station: `syscall_gate`

Runs entry work (`syscall_enter_from_user_mode`, which calls
`syscall_trace_enter` when work is pending), dispatches the call through
`do_syscall_x64` and `x64_sys_call`, then runs exit work. It is marked
`noinstr`, so fentry and kprobes cannot attach to it.

## x64-sys-call

- Kernel: `v6.18`
- Location: `arch/x86/entry/syscall_64.c`, function `x64_sys_call`
- Status: verified
- Event: `func_entry` / `func_exit` with `fn: "x64_sys_call"`
- Station: `syscall_gate`

A switch over the system call table. For `read` it calls `__x64_sys_read`,
the wrapper made by `SYSCALL_DEFINE3(read, ...)` in `fs/read_write.c`, which
calls `ksys_read`.

## ksys-read

- Kernel: `v6.18`
- Location: `fs/read_write.c`, function `ksys_read`
- Status: verified
- Event: `func_entry` / `func_exit` with `fn: "ksys_read"`
- Station: `vfs`

Gets the file from the descriptor, copies the file position, calls
`vfs_read`, and stores the advanced position back.

## vfs-read

- Kernel: `v6.18`
- Location: `fs/read_write.c`, function `vfs_read`
- Status: verified
- Event: `func_entry` / `func_exit` with `fn: "vfs_read"`
- Station: `vfs`

Checks that the file is open for reading, that the user range is valid and
that locks allow the read. ext4 files have `.read_iter` and no `.read`, so it
calls `new_sync_read`. On success it updates read accounting.

## new-sync-read

- Kernel: `v6.18`
- Location: `fs/read_write.c`, function `new_sync_read` (static)
- Status: verified
- Event: `func_entry` / `func_exit` with `fn: "new_sync_read"`
- Station: `vfs`

Builds a synchronous kiocb and a user-buffer iov_iter, calls the file's
`read_iter`, and copies the new position back.

## ext4-file-read-iter

- Kernel: `v6.18`
- Location: `fs/ext4/file.c`, function `ext4_file_read_iter`, installed as
  `.read_iter` in `ext4_file_operations`
- Status: verified
- Event: `func_entry` / `func_exit` with `fn: "ext4_file_read_iter"`
- Station: `fs:ext4`

Returns early on a shut-down filesystem or empty read. DAX files and
`O_DIRECT` reads go elsewhere. A buffered read goes to
`generic_file_read_iter`.

## generic-file-read-iter

- Kernel: `v6.18`
- Location: `mm/filemap.c`, function `generic_file_read_iter`
- Status: verified
- Event: `func_entry` / `func_exit` with `fn: "generic_file_read_iter"`
- Station: `page_cache`

Handles direct I/O when asked; otherwise calls `filemap_read`.

## filemap-read

- Kernel: `v6.18`
- Location: `mm/filemap.c`, function `filemap_read`
- Status: verified
- Event: `func_entry` / `func_exit` with `fn: "filemap_read"`
- Station: `page_cache`

The buffered read loop. Each round gets a batch of up-to-date folios from
`filemap_get_pages`, checks the file size, marks the first folio accessed,
copies each folio to the user buffer with `copy_folio_to_iter`, and drops the
folio references. At the end it updates the access time and the readahead
state's previous position.

## filemap-get-pages

- Kernel: `v6.18`
- Location: `mm/filemap.c`, function `filemap_get_pages` (static)
- Status: verified
- Event: `func_entry` / `func_exit` with `fn: "filemap_get_pages"`; the
  lookup inside it maps to `page_cache_lookup`
- Station: `page_cache`

Looks up folios with `filemap_get_read_batch`. On an empty result it runs
`page_cache_sync_ra` and looks again; if still empty it falls back to
`filemap_create_folio`. If the last folio has the readahead mark it starts
async readahead. If a folio is not up to date it calls
`filemap_update_page`, and retries the whole lookup when that returns
"truncated page" (which it does after waiting on a locked folio). On success
it fires the `mm_filemap_get_pages` tracepoint.

## filemap-get-read-batch

- Kernel: `v6.18`
- Location: `mm/filemap.c`, function `filemap_get_read_batch` (static)
- Status: verified
- Event: `page_cache_lookup`
- Station: `page_cache`

Walks the mapping's xarray under RCU from the start index, taking a
reference on each folio found. It stops at a gap, at a folio that is not up
to date, or at one with the readahead mark.

## page-cache-sync-ra

- Kernel: `v6.18`
- Location: `mm/readahead.c`, function `page_cache_sync_ra` (exported)
- Status: verified
- Event: `func_entry` / `func_exit` with `fn: "page_cache_sync_ra"`
- Station: `page_cache`

Synchronous readahead after a miss. Fires the `page_cache_sync_ra`
tracepoint, sizes the window (4 pages for a one-page read at offset 0, see
"Readahead on a cold read") and calls `page_cache_ra_order`.

## page-cache-ra-order

- Kernel: `v6.18`
- Location: `mm/readahead.c`, function `page_cache_ra_order`
- Status: verified
- Event: none in Stage 1
- Station: `page_cache`

Allocates folios for the window, up to end of file, through
`ra_alloc_folio`, which also sets the readahead mark on the async boundary
and inserts each folio with `filemap_add_folio`. Then calls `read_pages`.
Falls back to `do_page_cache_ra` and `page_cache_ra_unbounded` when the
mapping has no large folio support or an allocation fails.

## filemap-alloc-folio

- Kernel: `v6.18`
- Location: `mm/filemap.c`, function `filemap_alloc_folio_noprof` (macro
  `filemap_alloc_folio`), called from `ractl_alloc_folio` in
  `mm/readahead.c`
- Status: verified
- Event: `mm_page_alloc` fires inside the page allocator
  (`__alloc_frozen_pages_noprof`, `mm/page_alloc.c`)
- Station: `page_cache`

Allocates a folio of the requested order, spreading over memory nodes if
the cpuset asks for it.

## filemap-add-folio

- Kernel: `v6.18`
- Location: `mm/filemap.c`, functions `filemap_add_folio` and
  `__filemap_add_folio`
- Status: verified
- Event: `mm_filemap_add_to_page_cache` (fired in `__filemap_add_folio`)
- Station: `page_cache`

Charges the folio to the memory cgroup, sets it locked, stores it in the
mapping's xarray and adds it to the LRU. The folio stays locked until read
completion unlocks it.

## read-pages

- Kernel: `v6.18`
- Location: `mm/readahead.c`, function `read_pages` (static)
- Status: verified
- Event: none in Stage 1
- Station: `page_cache`

Opens a block plug, calls the filesystem's `->readahead` (or `->read_folio`
per folio if there is none), cleans up folios the filesystem did not take,
and closes the plug, which submits the queued requests.

## ext4-readahead

- Kernel: `v6.18`
- Location: `fs/ext4/inode.c`, function `ext4_readahead`, installed as
  `.readahead` in the ext4 address space operations
- Status: verified
- Event: `func_entry` / `func_exit` with `fn: "ext4_readahead"`
- Station: `fs:ext4`

Skips inline-data inodes; otherwise calls `ext4_mpage_readpages` with the
readahead control.

## ext4-mpage-readpages

- Kernel: `v6.18`
- Location: `fs/ext4/readpage.c`, function `ext4_mpage_readpages`
- Status: verified
- Event: `func_entry` / `func_exit` with `fn: "ext4_mpage_readpages"`
- Station: `fs:ext4`

For each folio, maps its blocks with `ext4_map_blocks`. While blocks stay
contiguous it adds folios to one bio (marked `REQ_RAHEAD` on the readahead
path, end_io `mpage_end_io`); a discontiguity or boundary submits the bio
with `submit_bio` and starts another. Holes are zeroed and completed at once.

## submit-bio

- Kernel: `v6.18`
- Location: `block/blk-core.c`, function `submit_bio`
- Status: verified
- Event: `func_entry` / `func_exit` with `fn: "submit_bio"`
- Station: `block`

Counts the read for task I/O accounting and `pgpgin`, sets I/O priority, and
calls `submit_bio_noacct`.

## submit-bio-noacct

- Kernel: `v6.18`
- Location: `block/blk-core.c`, function `submit_bio_noacct`
- Status: verified
- Event: `func_entry` / `func_exit` with `fn: "submit_bio_noacct"`
- Station: `block`

Checks the bio against the device and its limits, applies throttling, then
calls `submit_bio_noacct_nocheck`.

## submit-bio-noacct-nocheck

- Kernel: `v6.18`
- Location: `block/blk-core.c`, function `submit_bio_noacct_nocheck`
- Status: verified
- Event: `block_bio_queue`
- Station: `block`

Fires `block_bio_queue` once per bio, then for a blk-mq device calls
`__submit_bio_noacct_mq`, which calls `__submit_bio` and so
`blk_mq_submit_bio`.

## blk-mq-submit-bio

- Kernel: `v6.18`
- Location: `block/blk-mq.c`, function `blk_mq_submit_bio`
- Status: verified
- Event: `func_entry` / `func_exit` with `fn: "blk_mq_submit_bio"`
- Station: `block`

Tries to merge the bio into a plugged or queued request; otherwise gets a
new request (`block_getrq`), fills it from the bio and, because a plug is
active (from `read_pages`), adds it to the plug with `blk_add_rq_to_plug`.
Without a plug it would insert or issue directly.

## blk-finish-plug

- Kernel: `v6.18`
- Location: `block/blk-core.c`, functions `blk_finish_plug` and
  `__blk_flush_plug`
- Status: verified
- Event: none in Stage 1
- Station: `block`

Flushes the task's plug through `blk_mq_flush_plug_list`. The inner plug that
`__submit_bio` opens is not the current one, so only the outer plug from
`read_pages` flushes.

## blk-mq-flush-plug-list

- Kernel: `v6.18`
- Location: `block/blk-mq.c`, function `blk_mq_flush_plug_list`
- Status: verified
- Event: none in Stage 1
- Station: `block`

Without scheduler requests, sends the list to the driver in one go
(`blk_mq_dispatch_queue_requests`, using `queue_rqs` when the driver has it).
With scheduler requests, `blk_mq_dispatch_list` passes them to the
scheduler's `insert_requests` and runs the queue.

## dd-insert-request

- Kernel: `v6.18`
- Location: `block/mq-deadline.c`, function `dd_insert_request`, called from
  `dd_insert_requests`
- Status: verified
- Event: `block_rq_insert`
- Station: `block`

mq-deadline's insert: fires `block_rq_insert` and adds the request to the
scheduler's sorted and FIFO lists.

## blk-mq-run-hw-queue

- Kernel: `v6.18`
- Location: `block/blk-mq.c`, function `blk_mq_run_hw_queue`
- Status: verified
- Event: none in Stage 1
- Station: `block`

If the queue has work, runs it now on this CPU (when the CPU is in the
hardware context's mask and the caller did not ask for async), through
`blk_mq_sched_dispatch_requests` in `block/blk-mq-sched.c`; otherwise
schedules a worker.

## blk-mq-dispatch-rq-list

- Kernel: `v6.18`
- Location: `block/blk-mq.c`, function `blk_mq_dispatch_rq_list`, called
  from `__blk_mq_do_dispatch_sched` in `block/blk-mq-sched.c`
- Status: verified
- Event: none in Stage 1
- Station: `block`

Gets a driver tag and budget for each request and calls the driver's
`queue_rq`, handling busy returns by requeueing.

## virtio-queue-rq

- Kernel: `v6.18`
- Location: `drivers/block/virtio_blk.c`, function `virtio_queue_rq`
  (`.queue_rq` in `virtio_mq_ops`)
- Status: verified
- Event: `func_entry` / `func_exit` with `fn: "virtio_queue_rq"`;
  `block_rq_issue` fires inside it
- Station: `driver:virtio_blk`

Sets up the virtio command and scatter list (`virtblk_prep_rq`, which calls
`blk_mq_start_request`), adds the buffers to the virtqueue under the queue
lock, and if this is the last request of the batch and the device wants a
notification, calls `virtqueue_notify`.

## blk-mq-start-request

- Kernel: `v6.18`
- Location: `block/blk-mq.c`, function `blk_mq_start_request`
- Status: verified
- Event: `block_rq_issue`
- Station: `driver:virtio_blk`

Fires `block_rq_issue`, starts the timeout timer and marks the request in
flight. Called by the driver, so `block_rq_issue` comes after
`func_entry virtio_queue_rq`, not before it.

## virtqueue-kick

- Kernel: `v6.18`
- Location: `drivers/virtio/virtio_ring.c`, function `virtqueue_kick`
- Status: drop
- Event: none
- Station: `driver:virtio_blk`

Exists, but on the normal path `virtio_queue_rq` does not call it. It calls
`virtqueue_kick_prepare` and then `virtqueue_notify` (the two halves of a
kick). `virtqueue_kick` is called only when adding the buffers fails. Use
`virtqueue_notify` in the model.

## virtqueue-notify

- Kernel: `v6.18`
- Location: `drivers/virtio/virtio_ring.c`, function `virtqueue_notify`
  (exported)
- Status: verified
- Event: `func_entry` / `func_exit` with `fn: "virtqueue_notify"`; marks the
  hand-over for `hw_io_start`
- Station: `driver:virtio_blk`

Calls the transport's notify hook, which for virtio-pci writes the queue
index to the device's notify address. This is where the request leaves the
kernel.

## filemap-update-page

- Kernel: `v6.18`
- Location: `mm/filemap.c`, function `filemap_update_page` (static)
- Status: verified
- Event: none in Stage 1
- Station: `page_cache`

Tries to lock the folio. If readahead still holds the lock, it waits with
`folio_put_wait_locked` and returns "truncated page" so the caller looks up
again. If it gets the lock and the folio is not up to date, it reads it with
`filemap_read_folio`.

## folio-wait-bit-common

- Kernel: `v6.18`
- Location: `mm/filemap.c`, function `folio_wait_bit_common` (static
  inline), reached from `folio_put_wait_locked`
- Status: verified
- Event: `func_entry` / `func_exit` with `fn: "folio_wait_bit_common"`
  (model only, see open questions)
- Station: `page_cache`

Adds a waiter to the folio's hashed wait queue, sets the waiters flag, drops
the folio reference (DROP mode), sets the task state (TASK_KILLABLE here),
and calls `io_schedule` until the waiter is marked woken.

## io-schedule

- Kernel: `v6.18`
- Location: `kernel/sched/core.c`, function `io_schedule` (exported)
- Status: verified
- Event: none in Stage 1
- Station: `cpu:<n>`

Marks the task as in I/O wait, flushes any plug, calls `schedule`, and
restores the flag afterwards.

## schedule

- Kernel: `v6.18`
- Location: `kernel/sched/core.c`, functions `schedule` and `__schedule`
- Status: verified
- Event: `sched_switch`
- Station: `cpu:<n>`

Dequeues the sleeping task, picks the next one and fires `sched_switch`
before the context switch.

## vring-interrupt

- Kernel: `v6.18`
- Location: `drivers/virtio/virtio_ring.c`, function `vring_interrupt`
  (exported); registered per queue by `vp_find_one_vq_msix` in
  `drivers/virtio/virtio_pci_common.c`
- Status: verified
- Event: `func_entry` / `func_exit` with `fn: "vring_interrupt"`; runs between
  `irq_handler_entry` and `irq_handler_exit`
- Station: `irq`

Returns "not handled" if the ring has no new used buffers. Otherwise calls
the queue's callback, which for `virtio_blk` is `virtblk_done`.

## virtblk-done

- Kernel: `v6.18`
- Location: `drivers/block/virtio_blk.c`, function `virtblk_done`
- Status: verified
- Event: `func_entry` / `func_exit` with `fn: "virtblk_done"`
- Station: `driver:virtio_blk`

Under the queue lock, with callbacks disabled, takes each used buffer off
the ring and calls `blk_mq_complete_request` on its request; repeats until
re-enabling callbacks finds no more. Restarts stopped queues if anything
completed. Runs in hardirq.

## blk-mq-complete-request

- Kernel: `v6.18`
- Location: `block/blk-mq.c`, functions `blk_mq_complete_request` and
  `blk_mq_complete_request_remote`
- Status: verified
- Event: `func_entry` / `func_exit` with `fn: "blk_mq_complete_request"`
- Station: `block`

Decides where completion runs (see "Interrupt and softirq context"). If not
deferred, calls the driver's `->complete` at once.

## blk-mq-raise-softirq

- Kernel: `v6.18`
- Location: `block/blk-mq.c`, function `blk_mq_raise_softirq`; remote case
  `blk_mq_complete_send_ipi` and `__blk_mq_complete_request_remote`
- Status: verified
- Event: `softirq_raise` with vec 4 (BLOCK)
- Station: `softirq`

Adds the request to this CPU's completion list and raises BLOCK_SOFTIRQ if
the list was empty. The remote variant adds it to the submitting CPU's list
and raises the softirq there by IPI.

## blk-done-softirq

- Kernel: `v6.18`
- Location: `block/blk-mq.c`, functions `blk_done_softirq` and
  `blk_complete_reqs`; registered with `open_softirq(BLOCK_SOFTIRQ, ...)`
- Status: verified
- Event: runs between `softirq_entry` and `softirq_exit` (vec 4)
- Station: `softirq`

Takes this CPU's completion list and calls the driver's `->complete` for
each request.

## virtblk-request-done

- Kernel: `v6.18`
- Location: `drivers/block/virtio_blk.c`, function `virtblk_request_done`
  (`.complete` in `virtio_mq_ops`)
- Status: verified
- Event: none in Stage 1
- Station: `driver:virtio_blk`

Turns the virtio status byte into a block status, unmaps the data, and calls
`blk_mq_end_request`.

## blk-mq-end-request

- Kernel: `v6.18`
- Location: `block/blk-mq.c`, functions `blk_mq_end_request` and
  `blk_update_request`
- Status: verified
- Event: `block_rq_complete` (fired at the start of `blk_update_request`)
- Station: `block`

`blk_update_request` fires `block_rq_complete`, accounts the bytes and calls
`bio_endio` for each finished bio. `__blk_mq_end_request` then frees the
request.

## bio-endio

- Kernel: `v6.18`
- Location: `block/bio.c`, function `bio_endio` (exported)
- Status: verified
- Event: `func_entry` / `func_exit` with `fn: "bio_endio"`
- Station: `block`

Handles chained bios, fires `block_bio_complete` for traced bios, and calls
the bio's `bi_end_io`, here `mpage_end_io`.

## mpage-end-io

- Kernel: `v6.18`
- Location: `fs/ext4/readpage.c`, functions `mpage_end_io` and
  `__read_end_io` (both static)
- Status: verified
- Event: none in Stage 1
- Station: `fs:ext4`

If the inode needs decryption or verity checks, queues that work on a
workqueue and finishes later. Otherwise `__read_end_io` calls
`folio_end_read` for every folio in the bio, with success when the bio had
no error, and frees the bio.

## folio-end-read

- Kernel: `v6.18`
- Location: `mm/filemap.c`, function `folio_end_read` (exported)
- Status: verified
- Event: `folio_end_read` (tier P), payload `ino`, `index`, `ok`
- Station: `page_cache`

In one atomic step sets the up-to-date flag (on success) and clears the
locked flag. If the folio had waiters, calls `folio_wake_bit`. Context: the
caller's. On this path it runs from the request completion, so in the BLOCK
softirq with one queue, or in the hardirq with one queue per CPU. With
fscrypt or fs-verity it runs in a workqueue (process context) instead.

## folio-wake-bit

- Kernel: `v6.18`
- Location: `mm/filemap.c`, functions `folio_wake_bit` and
  `wake_page_function`
- Status: verified
- Event: none in Stage 1
- Station: `page_cache`

Walks the folio's hashed wait queue. `wake_page_function` matches waiters
for this folio and bit, marks them woken and calls `wake_up_state`, which is
`try_to_wake_up`.

## try-to-wake-up

- Kernel: `v6.18`
- Location: `kernel/sched/core.c`, functions `try_to_wake_up`,
  `select_task_rq`, `ttwu_queue`, `ttwu_do_wakeup`
- Status: verified
- Event: `sched_waking` (in `try_to_wake_up`), `sched_wakeup` (in
  `ttwu_do_wakeup`)
- Station: `runqueue:<target>`

Fires `sched_waking`, picks the CPU with `select_task_rq`, and either
activates the task on that CPU's run queue now or sends it to the CPU's wake
list. `ttwu_do_wakeup` sets the task running and fires `sched_wakeup`.

## copy-page-to-iter

- Kernel: `v6.18`
- Location: `lib/iov_iter.c`, function `copy_page_to_iter` (exported);
  reached from `copy_folio_to_iter` (inline, `include/linux/uio.h`)
- Status: verified
- Event: `copy_to_user`
- Station: `syscall_gate`

Maps the page and calls `_copy_to_iter` (exported, `lib/iov_iter.c`), whose
inline helper `copy_to_user_iter` checks the range and calls
`raw_copy_to_user` (`arch/x86/include/asm/uaccess_64.h`), which does the copy
with `copy_user_generic`.

## syscall-exit-work

- Kernel: `v6.18`
- Location: `kernel/entry/syscall-common.c`, function `syscall_exit_work`,
  called from `syscall_exit_to_user_mode_work` in
  `include/linux/entry-common.h`
- Status: verified
- Event: `sys_exit`
- Station: `syscall_gate`

Exit work when any syscall work flag is set: audit, the `sys_exit`
tracepoint, and ptrace reporting.
