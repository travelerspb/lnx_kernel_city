# Verification log

Checked on 2026-11-25. "Verified" means read from a primary source on that
date. "From memory" means nobody has checked it yet; WP1 must check it before
the model relies on it.

## Corrections to the first plan

| First plan said | Finding | Change |
|---|---|---|
| "Keep PGSimCity's rule that every mechanism cites a source file and function" | PGSimCity has no such rule. References are inline in `src/sim/model.ts` and `docs/MODEL-ACCURACY.md`. Its `evidence/` directory holds visual material. Accuracy is enforced by a nightly job against PostgreSQL 18. | `evidence/` is our own convention. The nightly check moves to Stage 6. |
| Sim and world "meet only at SimState" | True, but there is no event log in `SimState`. The world polls state each frame. The bus carries only presentation events such as `flow`. | Event-sourced state is a deliberate departure (D4). |
| "Run Linux under v86" for the optional real kernel | v86 README: "64-bit kernels are not supported." | v86 removed. TinyEMU riscv64 (MIT, custom kernel supported) is the verified option. container2wasm runs x86_64 through Bochs; kernel customisation is not verified. |
| "x86_64 only" with traces from colima on this Mac | This Mac is arm64, so a native colima guest is aarch64. | Schema is architecture neutral. See D2. |
| Event schema "modelled on real tracepoints" | Tracepoints do not cover the whole path. There is none for `vfs_read` or for a page-cache hit. | Schema has three tiers: tracepoint, probe, synthetic. See `EVENT_SCHEMA.md`. |
| "A few days" for scope | Not checked, no basis | Removed. No time estimates in this plan. |

## PGSimCity facts (verified from the repository, branch `main`)

| Fact | Source |
|---|---|
| Fixed model step of 1/30 s, wall delta clamped to 2 s | `src/core/timebase.ts`, `src/sim/model.ts` |
| Seeded RNG, default seed `0xc0ffee`; separate RNG for presentation | `src/sim/model.ts` |
| Replay record is seed, run-length step list and actions. No state snapshots. Rewind resets and re-runs. | `src/sim/replay.ts` |
| `SimState` type lives in `src/core/types.ts`; objects are built once and reset in place | `src/core/types.ts`, `src/sim/model.ts` |
| Transient things are fixed slot arrays with state machines, for example 16 backends | `src/core/types.ts` |
| `layout.ts` exports named anchors, routes and district bounds. One unit is about one metre, Y up, north is -Z. | `src/world/layout.ts` |
| Bus API: `on`, `off`, `once`, `emit`; a throwing handler does not stop the others | `src/core/bus.ts` |
| Scenarios and tour chapters are typed arrays in code, not data files | `src/sim/scenarios.ts`, `src/ui/tour.ts` |
| A test walks the import graph from the model and fails on `three` or `src/world` | `test/sim-boundary.test.ts` |
| CI: fast tests, Chrome tests, typecheck and build; Pages deploy needs all three | `.github/workflows/ci.yml`, `pages.yml` |
| Licence is Apache-2.0 | `LICENSE` |

Not read: the body of `update()` in `model.ts`, `makeRng`, `src/engine`,
`src/world` other than `layout.ts`.

## Kernel facts

Version (verified, kernel.org): mainline 7.4-rc4, latest stable 7.3.6, newest
longterm series 6.18 (released 2025-11-30, projected end of life December
2028). The end-of-life table on kernel.org carried an older date stamp than the
home page.

Tracepoints at tag `v6.18`:

| Tracepoint | Status | Header |
|---|---|---|
| `sched_switch`, `sched_wakeup`, `sched_waking` | Verified | `include/trace/events/sched.h` |
| `sched_process_fork`, `sched_process_exec`, `sched_process_exit` | Verified | `include/trace/events/sched.h` |
| `irq_handler_entry`, `irq_handler_exit` | Verified | `include/trace/events/irq.h` |
| `softirq_raise`, `softirq_entry`, `softirq_exit` | Verified | `include/trace/events/irq.h` |
| `mm_page_alloc`, `kmem_cache_alloc`, `kmalloc` | Verified | `include/trace/events/kmem.h` |
| `signal_generate`, `signal_deliver` | Verified | `include/trace/events/signal.h` |
| `net_dev_xmit`, `netif_receive_skb` | Verified | `include/trace/events/net.h` |
| `page_fault_user`, `page_fault_kernel` | Verified, generic | `include/trace/events/exceptions.h` |
| `napi_poll` | Verified | `include/trace/events/napi.h` |
| `block_rq_insert`, `block_rq_issue`, `block_rq_complete`, `block_bio_queue` | Verified by WP1 from a local clone of `v6.18`. Fields in `evidence/tracepoints.md`. | `include/trace/events/block.h` |
| `mm_filemap_add_to_page_cache`, `mm_filemap_delete_from_page_cache` | Verified by WP1 | `include/trace/events/filemap.h` |
| `sys_enter`, `sys_exit` | Verified by WP1. Trace system `raw_syscalls`; fields `id`, `args[6]` and `id`, `ret` | `include/trace/events/syscalls.h` |

Functions on the `read()` path: verified by WP1 on 2026-11-25 from a sparse
shallow clone of tag `v6.18` (commit `7d0a66e`). The corrected chain for
cold and warm reads is in `evidence/read-path.md`; anything still open is in
`evidence/open-questions.md`. Corrections to the candidate chain:
`virtqueue_kick` is not on the normal path (the driver calls
`virtqueue_kick_prepare` and `virtqueue_notify`); `block_rq_issue` fires
inside `virtio_queue_rq`; a cold one-page read at offset 0 reads ahead 4
pages; with one virtio-blk queue the default scheduler is `mq-deadline` and
completion runs in the BLOCK softirq, with one queue per CPU it is `none` and
completion runs in the hardirq.

## Browser emulators (verified from project pages)

| Project | Guest | 64-bit | Custom kernel | Guest-to-page channel | Licence |
|---|---|---|---|---|---|
| v86 | x86 32-bit | No | Not verified | Serial, 9p over virtio | BSD-2-Clause |
| container2wasm | x86_64 (Bochs), riscv64 (TinyEMU), QEMU Wasm | Yes | Not verified | 9p over virtio, stdio | Apache-2.0 |
| TinyEMU | riscv64 | Yes | Yes | VirtIO console, 9p | MIT |
| JSLinux x86_64 | x86_64 | Yes | Not verified, source not verified | VFsync | Not stated |

No maintained port of a modern kernel to WebAssembly was found.

## Local machine (verified)

arm64, Node v24.21.0, npm 11.19.0, git 2.56.1, no pnpm. The project directory
is empty and is not a git repository.
