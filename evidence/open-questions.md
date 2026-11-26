# Open questions

Things WP1 could not confirm from the `v6.18` source. Each is marked
"not verified". None of them is stated as fact elsewhere in `evidence/`.

## Queue count of the hypervisor's virtio-blk device

Not verified. The kernel uses the device's `num_queues` (capped by the
`num_request_queues` module parameter and by possible CPUs, `init_vq` in
`drivers/block/virtio_blk.c`). How many queues QEMU, colima or another
hypervisor exposes by default is hypervisor configuration, outside the
kernel. It decides between the single-queue chain (mq-deadline,
`block_rq_insert`, BLOCK softirq) and the multi-queue chain (none, no
insert, hardirq completion). The model assumes one queue. WP6 can check with
`/sys/block/vda/mq/` and `/sys/block/vda/queue/scheduler` in a real guest.

## Effective CPU of a single-queue interrupt

Not verified. With one queue the managed vector's affinity mask covers all
CPUs; which CPU the x86 vector allocator chooses as the effective target
was not read (`arch/x86/kernel/apic/vector.c` is in the clone but was not
studied). The model picks a CPU other than the reader's.

## Cache sharing between vCPUs

Not verified. `blk_mq_complete_need_ipi` completes locally when the
interrupt CPU shares a cache with the submitting CPU. Whether vCPUs share a
last-level cache domain depends on the topology the hypervisor reports. If
they do not, the completion is sent by IPI to the submitting CPU and the
BLOCK softirq runs there instead of on the interrupt CPU.

## Wakeup placement

Not verified for this scenario. `select_task_rq_fair` with `wake_affine`
and `select_idle_sibling` depends on load and idle state at run time, so the
target CPU cannot be fixed from code. The model's choice is a model
decision.

## Inlining of static functions

Not verified. `new_sync_read`, `filemap_get_pages`, `filemap_get_read_batch`,
`filemap_update_page`, `read_pages` and `folio_wait_bit_common` are static
(the last is `static inline`). Whether they keep a body that fentry or
kprobes can attach to depends on the compiler and config. A real trace may
not see `func_entry` for them. Check with `/sys/kernel/tracing/available_filter_functions`
in WP6.

## Device-side behaviour of virtio-blk

Not verified beyond the driver side. The `hw_io_*` descriptions follow the
driver's use of the available and used rings and notifications in
`drivers/virtio/virtio_ring.c` and `drivers/block/virtio_blk.c`. What the
host back end does in between is outside the kernel source.

## Per-syscall trace events

Not verified in detail. `kernel/trace/trace_syscalls.c` builds
`syscalls/sys_enter_<name>` events with named arguments. Field names for
`sys_enter_read` were not checked.

## Readahead window when bdi limits differ

Not verified for a specific device. The window of 4 pages holds when
`ra_pages` is at least 32 pages, which the block layer guarantees by default
(`VM_READAHEAD_PAGES` is 128 KiB, 32 pages of 4 KiB, applied as a floor in
`blk_apply_bdi_limits`, `block/blk-settings.c`). A user can lower it through
sysfs (`read_ahead_kb`) or `blockdev --setra`; below 32 pages
`get_init_ra_size` doubles the request instead of quadrupling it, and at 0
readahead is off. The actual `read_ahead_kb` of the guest's `vda` is not
verified.
