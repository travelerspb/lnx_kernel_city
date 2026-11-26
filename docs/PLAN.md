# Plan

Draft. Nothing here is final until the decisions in the last section are
confirmed. Facts are tracked in `VERIFICATION.md`.

## Goal

A static web page that shows the Linux kernel as a city. A viewer can follow one
request, such as a `read()`, from a user process through the syscall boundary,
the kernel subsystems and a driver to hardware and back, and can see which task
holds which CPU at each moment.

## What we take from PGSimCity, and what we change

Taken as is:

- Stack: TypeScript, Vite, three.js, vitest, npm. Static bundle, no server.
- `world/layout.ts` is the only owner of geography.
- The sim never imports three.js. The world never mutates state.
- UI and world talk only through an event bus.
- Fixed seed, deterministic model, replay by re-running from the seed.
- A test that walks the import graph and fails if the sim reaches three.js.

Changed:

- **Event-sourced state.** PGSimCity's world polls `SimState`, and its model
  mutates state directly. Here every state change goes through
  `apply(state, event)`. The synthetic model and a recorded real trace are both
  just event sources. This is what makes real-trace replay possible later
  without a redesign.
- **Paths, not buildings.** PostgreSQL is one program with about a dozen process
  types. The kernel has dozens of subsystems and most requests cross several.
  The unit of the city is a path through named stations.
- **Explicit evidence files.** PGSimCity keeps source references inline and in
  `docs/MODEL-ACCURACY.md`, and checks facts nightly against a real PostgreSQL.
  We keep a file per mechanism under `evidence/` that cites kernel file and
  function at the pinned tag. The nightly check against a real kernel comes in
  Stage 6.
- **Two clocks.** Kernel events are nanoseconds apart and then nothing happens
  for 200 microseconds. A linear clock is unwatchable. See the time model in
  `ARCHITECTURE.md`.

## Stages

Each stage ends with a deployable page. A stage does not start until the
previous one meets its exit criteria.

| # | Stage | Scope | Exit criteria |
|---|---|---|---|
| 1 | Walking skeleton | Contracts, scaffold, one scenario: a cold `read()` then a warm `read()` on 4 CPUs with 3 tasks. Details in `stage-1/README.md`. | Page deploys. The scenario plays, pauses and steps. Every event shown links to an evidence entry. Same seed gives the same event stream. |
| 2 | Scheduler and process lifecycle | Runqueues, EEVDF pick, preemption, timer tick, `fork`/`exec`/`exit`/`wait`, kernel threads, PID 1 and daemons as long-lived tasks, cgroup CPU limits. Scenario framework and rewind. | Scenarios "fork bomb", "CPU hog versus interactive task" and "daemon start at boot" play. Rewind works by re-running from the seed. |
| 3 | Memory and storage depth | Page faults, buddy and slab allocators, reclaim and `kswapd`, swap, OOM killer, `write()` and writeback, `fsync`, I/O scheduler queue. | Scenarios "memory pressure", "slow disk" and "dirty page writeback" play. |
| 4 | Interrupts, drivers, signals | Hardirq, softirq, threaded IRQ, workqueues, timers. Device model: bus, probe, `/dev`, `/sys`, udev. An input path from keyboard to TTY. Signal generation and delivery. | Scenarios "key press to shell", "Ctrl-C kills a process" and "hot-plug a device" play. |
| 5 | Network | Socket, TCP, IP, netfilter, qdisc, NIC driver on transmit. NAPI, softirq and socket wakeup on receive. | Scenarios "HTTP request in and out" and "SYN flood" play. |
| 6 | Real-trace replay | Capture on a Linux VM with bpftrace or perf, convert to the event schema, snapshot initial state, replay the file in the page. Nightly job that diffs model output against a real trace. | A trace of a real `cat` of a cold file replays through the same world code as the model. |
| 7 | Tour and polish | Guided tour, 3D camera and level of detail, inspector depth. Optional: a real kernel in the browser. | Tour covers every district. |

Notes on order:

- Signals, daemons and drivers were named in the original request. Daemons are
  in Stage 2. Drivers and signals are in Stage 4.
- Real traces are late, but the risk is handled early. Stage 1 has an optional
  spike (WP6) that captures a real `read()` and checks that every Stage 1 event
  type can be recorded. Each later stage repeats that check for its own events.
- The in-browser kernel is optional and last. v86 cannot be used, because it
  does not run 64-bit kernels. The verified open route is TinyEMU with a
  riscv64 kernel. See `VERIFICATION.md`.

## Decisions to confirm before Stage 1 starts

| # | Decision | Recommendation | Alternative |
|---|---|---|---|
| D1 | Kernel version to pin | `v6.18`, the newest longterm series, projected end of life December 2028 | A newer stable series, which loses support within months |
| D2 | Architecture | Evidence cites x86_64 for the entry path. The event schema is architecture neutral: syscalls by name, `arch` in the stream header. Real traces will come from an aarch64 guest, because this Mac is arm64. | arm64 everywhere, so the model and local traces match exactly |
| D3 | Renderer | three.js with an orthographic top-down camera. 3D comes in Stage 7. | Plain 2D canvas, which is simpler but is thrown away later |
| D4 | Core design | Event-sourced state, as described above | Copy PGSimCity's polling model and add traces later at higher cost |
| D5 | Hosting and CI | **Decided 2026-11-25: GitHub.** GitHub Actions for CI, GitHub Pages for the static build. | |
| D6 | Stage 1 storage stack | ext4 on `virtio_blk`, which is what a VM trace will show | NVMe, which is what bare metal shows |
| D7 | Run WP6, the trace spike, in Stage 1 | Yes. It needs a small Linux VM in its own colima profile. The existing rigs are not touched. | Skip it and accept the schema risk until Stage 6 |
| D8 | Project name and licence | Licence: MIT, applied 2026-11-25 with the start of Stage 1. Name: Linux Kernel City, repository `lnx_kernel_city`. PGSimCity is Apache-2.0; we copy its pattern, not its code. `evidence/` cites kernel file and function and never pastes kernel source, so GPL-2.0 does not reach the project. | Apache-2.0, if code from PGSimCity is ever copied |

## Risks

| Risk | Handling |
|---|---|
| The model shows a path that the kernel does not take | Evidence file per mechanism, reviewed before the model work merges. Unverified items stay marked. |
| Real traces cannot supply an event the model emits | Three event tiers in the schema. WP6 spike in Stage 1. |
| Time scales span five orders of magnitude | Event-paced presentation clock, with true time always shown |
| Scope creep | One scenario per stage first. Districts not in the current stage are drawn as empty lots. |
| Real trace volume | Not a Stage 1 problem. Stage 6 filters by process and samples. |
