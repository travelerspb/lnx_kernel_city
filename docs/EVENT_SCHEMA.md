# Event schema, draft v0

The contract between event sources (the synthetic model now, recorded traces in
Stage 6) and everything downstream. TypeScript types in `src/core/types.ts`
are the source of truth once WP0 lands. This file explains them.

## Stream header

```ts
interface StreamHeader {
  schema: 'lkc-events/0';
  kernel: string;            // '6.18'
  arch: 'x86_64' | 'aarch64' | 'riscv64';
  ncpu: number;
  source: 'sim' | 'trace';
  seed?: number;             // sim only
  snapshot: Snapshot;        // tasks, files, devices that exist at ts = 0
}
```

A snapshot is needed because a stream starts in the middle of a running
system. The model writes it from the scenario. A real trace will fill it from
`/proc` at capture start.

## Event envelope

```ts
interface KEventBase {
  seq: number;     // strictly increasing within a stream
  ts: number;      // ns since stream start, never decreases
  cpu: number;     // CPU the event happened on
  pid: number;     // task that was current on that CPU; 0 is the idle task
  type: string;    // see the table below
  tier: 'T' | 'P' | 'S';
  flow?: number;   // correlates the events of one request
}
```

## Tiers

| Tier | Meaning | How a real trace gets it | Stability |
|---|---|---|---|
| `T` | One-to-one with a kernel tracepoint. Field names follow the tracepoint format. | Tracepoint | Stable across versions in practice |
| `P` | Entry or return of a named kernel function | fentry or kprobe | Tied to the pinned kernel version |
| `S` | No kernel hook exists. Hardware-side or model-only. | Inferred or absent | Model only |

Rules:

- Prefer `T`. Use `P` where no tracepoint exists. Use `S` only for things the
  kernel cannot observe, such as the device working on a request.
- The world must render a stream correctly when `S` events are missing.
- Syscalls are identified by name, not number. Numbers differ by architecture.
- `flow` is set by the model. A trace converter infers it or leaves it out.

## Stage 1 event types

"Verified" refers to `VERIFICATION.md`. Payload fields are a proposal for WP0.

| Type | Tier | Payload | Station | Tracepoint verified |
|---|---|---|---|---|
| `sys_enter` | T | `name`, `args` | `syscall_gate` | Pending |
| `sys_exit` | T | `name`, `ret` | `syscall_gate` | Pending |
| `func_entry` | P | `fn` | by function | n/a |
| `func_exit` | P | `fn`, `ret?` | by function | n/a |
| `page_cache_lookup` | P | `ino`, `index`, `hit` | `page_cache` | n/a |
| `mm_page_alloc` | T | `order` | `page_cache` | Yes |
| `mm_filemap_add_to_page_cache` | T | `ino`, `index` | `page_cache` | Pending |
| `folio_end_read` | P | `ino`, `index`, `ok` | `page_cache` | n/a |
| `block_bio_queue` | T | `dev`, `sector`, `nrSectors` | `block` | Pending |
| `block_rq_insert` | T | `dev`, `sector`, `nrSectors` | `block` | Pending |
| `block_rq_issue` | T | `dev`, `sector`, `nrSectors` | `driver:virtio_blk` | Pending |
| `hw_io_start` | S | `dev`, `sector` | `device:vda` | n/a |
| `hw_io_done` | S | `dev`, `sector` | `device:vda` | n/a |
| `irq_handler_entry` | T | `irq`, `name` | `irq` | Yes |
| `irq_handler_exit` | T | `irq`, `ret` | `irq` | Yes |
| `softirq_raise` | T | `vec` | `softirq` | Yes |
| `softirq_entry` | T | `vec` | `softirq` | Yes |
| `softirq_exit` | T | `vec` | `softirq` | Yes |
| `block_rq_complete` | T | `dev`, `sector`, `nrSectors`, `error` | `block` | Pending |
| `sched_waking` | T | `wakee`, `targetCpu` | `runqueue:<cpu>` | Yes |
| `sched_wakeup` | T | `wakee`, `targetCpu` | `runqueue:<cpu>` | Yes |
| `sched_switch` | T | `prevPid`, `prevState`, `nextPid` | `cpu:<cpu>` | Yes |
| `copy_to_user` | P | `bytes` | `syscall_gate` | n/a |

Changes made by WP0:

- `folio_end_read` added. Read completion marks the folio up to date and
  unlocks it; without an event for that moment the page state could not
  change through `apply`.
- `sched_waking` and `sched_wakeup` name the woken task `wakee`, because the
  envelope already has `pid` for the current task. The tracepoint fields are
  `pid` and `target_cpu`.
- For tier `S` hardware events (`hw_io_start`, `hw_io_done`), `cpu` is the CPU
  that will take the resulting interrupt and `pid` is informational: `apply`
  does not require it to be current.
- `dev` is the device name (`vda`). The block tracepoints report `dev_t` as
  major and minor; a trace converter maps it using the snapshot.

`func_entry` and `func_exit` carry the function name, so adding a function to
the path does not add an event type. `core/stations.ts` holds the map from
function name to station.

## Later stages

Added when the stage starts, each with its evidence entry:
`sched_process_fork`, `sched_process_exec`, `sched_process_exit` (Stage 2),
`page_fault_user`, `page_fault_kernel`, `kmem_cache_alloc`, `kmalloc`
(Stage 3), `signal_generate`, `signal_deliver` (Stage 4), `net_dev_xmit`,
`netif_receive_skb` (Stage 5).

## Serialisation

In memory: an array of events. On disk: a JSON file with `header` and
`events` for fixtures, and newline-delimited JSON for long traces in Stage 6.

## Validation

`core/validate.ts` checks: `seq` strictly increases, `ts` never decreases,
`cpu` is below `ncpu`, `type` is known, required payload fields are present,
and every pid appears in the snapshot or in an earlier fork event.
