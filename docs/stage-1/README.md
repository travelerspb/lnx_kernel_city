# Stage 1: walking skeleton

Draft. Starts after the decisions in `../PLAN.md` are confirmed.

## Goal

One scenario, end to end, on a deployed static page. Thin everywhere, complete
from event source to pixels. Stage 1 proves the contracts, not the visuals.

## The scenario: `cold-warm-read`

- 4 CPUs. 3 user tasks: `reader`, and two CPU-bound tasks `busy-a`, `busy-b`.
- A file of a few pages on ext4 on `/dev/vda` (`virtio_blk`). Nothing cached.
- `reader` calls `read(fd, buf, 4096)`:
  1. Cold: syscall entry, VFS, ext4, page cache miss, page allocated and
     locked, bio submitted, request queued and issued to the driver. `reader`
     sleeps and its CPU picks another task. The device finishes. An interrupt
     arrives on some CPU and preempts whatever runs there. Completion unlocks
     the page and wakes `reader`. `reader` is scheduled, copies to user space
     and returns.
  2. Warm: `reader` calls `pread64()` at offset 0, the same page. Page cache
     hit. No I/O, no sleep. A second plain `read()` would start at offset
     4096 and trigger async readahead (`evidence/read-path.md`).
- The viewer sees the two paths side by side in the event log and on the map.

Device configuration: single-queue `virtio_blk`, so the default I/O
scheduler is `mq-deadline` and completion runs in the hardirq and then the
BLOCK softirq. It is the only configuration where every Stage 1 event type
fires. The scheduler appears as one `block_rq_insert` event, without its
internals.

Not in Stage 1: readahead beyond one page, I/O scheduler internals, `fork`, timer
tick preemption, memory pressure, more than one device. If the real kernel
does one of these on this path, the evidence file says so and the model marks
it as skipped.

## Exit criteria

1. `npm test`, `npm run typecheck` and `npm run build` pass.
2. The page loads from the static build with no server.
3. The scenario plays in event-paced mode, pauses, steps one event at a time
   and resets.
4. Every event in the log shows its tier and links to an evidence entry.
5. The same seed gives a byte-identical event stream twice.
6. The boundary test proves the sim does not import three.js or the world.
7. The page is deployed on GitHub Pages.

## Work packages

```
WP0 scaffold and contracts ──┬──> WP2 sim model ───┐
                             ├──> WP3 world ───────┼──> WP5 integration and deploy
                             └──> WP4 ui ──────────┘
WP1 evidence, read path ────────> WP2 (step order)
WP6 trace spike (optional, needs a VM) ──> feeds EVENT_SCHEMA.md
```

- WP0 runs first and alone. It blocks WP2, WP3 and WP4.
- WP1 needs no code and can start at once, in parallel with WP0.
- WP2, WP3 and WP4 run in parallel after WP0. WP3 and WP4 work against the
  fixture stream from WP0, so they do not wait for WP2.
- WP5 runs last.
- WP6 is independent. It needs approval, because it starts a virtual machine.

## File ownership

One owner per path. A work package does not edit another package's paths. If
it needs a change there, it reports the need instead.

| Path | Owner |
|---|---|
| `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html` | WP0 |
| `src/core/**` | WP0 |
| `test/sim-boundary.test.ts`, `test/schema.test.ts`, `test/evidence-coverage.test.ts` | WP0 |
| `test/fixtures/cold-warm-read.events.json` | WP0 creates by hand, WP5 regenerates from the model |
| `src/world/layout.ts` | WP0 creates the station table, WP3 owns it afterwards |
| `evidence/**` except `evidence/trace-feasibility.md` | WP1 |
| `src/sim/**`, `test/determinism.test.ts` | WP2 |
| `src/world/**`, `src/engine/**` | WP3 |
| `src/ui/**`, `src/styles/**` | WP4 |
| `src/main.ts`, CI and deploy config, browser smoke test, `README.md` | WP5 |
| `tools/trace/**`, `evidence/trace-feasibility.md` | WP6 |

Changes to `src/core/types.ts` after WP0 go through whoever coordinates the
stage, because three packages depend on it.

## Briefs

- `WP0-scaffold-contracts.md`
- `WP1-evidence-read-path.md`
- `WP2-sim-model.md`
- `WP3-world-renderer.md`
- `WP4-ui-shell.md`
- `WP5-integration-deploy.md`
- `WP6-trace-spike.md`
