# WP2: synthetic model

Starts after WP0. Uses WP1's `evidence/read-path.md` for step order.

## Goal

A deterministic discrete-event model that implements `EventSource` and emits
the `cold-warm-read` scenario as a valid event stream.

## Read first

`docs/ARCHITECTURE.md` (hard rules, data flow, time model),
`docs/EVENT_SCHEMA.md`, `evidence/read-path.md`, `src/core/types.ts`.

## Owns

`src/sim/**`, `test/determinism.test.ts`.

## Must not touch

`src/core/**`, `src/world/**`, `src/ui/**`. If a contract is missing
something, report it.

## Deliverables

1. `src/sim/model.ts`: `createSim({ seed, scenario })` returning an
   `EventSource`. A private agenda ordered by timestamp. Decisions read
   `KernelState`; nothing in `sim/` writes to it.
2. Minimal scheduler: per-CPU runqueue, a task runs until it sleeps or the
   scenario ends, a woken task is placed on a CPU by a stated simple rule. No
   timer tick in Stage 1.
3. The read path, cold and warm, in the order given by the evidence file.
4. `src/sim/costs.ts`: every latency as a named constant with a comment that
   it is illustrative. Small seeded jitter on device latency.
5. `src/sim/scenarios.ts`: a typed scenario definition for `cold-warm-read`:
   CPUs, tasks, file, device, and the script of user actions.
6. Tests: determinism (same seed, identical stream), a different seed changes
   only timings and CPU choices, output passes `validate`, state invariants
   hold after every event, the ordering constraints below.

## Ordering constraints to test

- `sys_enter` comes before any kernel event of that flow; `sys_exit` is last.
- The page is `locked` before `block_bio_queue` and `uptodate` only after
  `block_rq_complete`.
- `sched_switch` away from `reader` comes after the request is issued and
  before `hw_io_done`.
- `irq_handler_entry` fires on a CPU while some other context was current
  there, and that context resumes after the handler chain ends.
- `sched_waking` for `reader` comes after `block_rq_complete`.
- The warm read emits no block, IRQ or scheduler events.

Adjust these if `evidence/read-path.md` shows the kernel orders them
differently, and cite the evidence in the test.

## Acceptance

- `npm test` passes.
- No `Math.random`, `Date.now` or `performance.now` under `src/sim`.
- The boundary test passes.

## Out of scope

Readahead, I/O scheduler, timer preemption, `fork`, rendering.
