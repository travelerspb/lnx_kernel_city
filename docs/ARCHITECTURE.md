# Architecture

Draft. WP0 turns this into code and may refine names. It may not change the
hard rules without updating this file and saying why.

## Hard rules

1. **State changes only in `apply`.** `core/apply.ts` exports
   `apply(state, event)`. Nothing else writes to `KernelState`.
2. **The sim never imports three.js or anything under `world/`, `engine/` or
   `ui/`.** A test walks the import graph and enforces this.
3. **The world never mutates state and never calls the sim.** It reads
   `KernelState` each frame and listens on the bus.
4. **`world/layout.ts` is the only place with coordinates.** Everything else
   refers to stations by id.
5. **The sim is deterministic.** No `Math.random`, `Date.now` or
   `performance.now` under `sim/` or `core/apply.ts`. Randomness comes from the
   seeded RNG in `core/rng.ts`.
6. **Every event type has an evidence entry.** A test fails if an event type
   in the schema has no matching entry under `evidence/`.
7. **Runtime dependencies: three.js only.**

## Directory layout

```
src/
  core/        types.ts     KEvent, KernelState, StationId, bus event map
               apply.ts     the reducer
               runtime.ts   pulls events from a source, applies, emits
               bus.ts       typed event bus
               rng.ts       seeded RNG
               timebase.ts  sim clock and presentation clock
               validate.ts  runtime check of an event stream
               glossary.ts  what each zone, district, station and state is; read by world and ui
  sim/         model.ts     synthetic kernel model, an EventSource
               costs.ts     latency parameters, marked illustrative
               scenarios.ts typed scenario definitions
  world/       layout.ts    stations, routes, district bounds
               districts/   one module per district, each with update()
               flows.ts     moving markers along routes
  engine/      renderer, camera, picking
  ui/          transport controls, event log, inspector, legend
  main.ts      boot and frame loop
evidence/      one file per mechanism, cites kernel file and function
test/          boundary tests, fixtures, browser smoke test
tools/trace/   capture scripts (Stage 1 spike, Stage 6 pipeline)
```

## Data flow

```
EventSource --next(state)--> runtime --apply(state, ev)--> KernelState
 (sim model                     |                               |
  or trace file)                +--bus 'kevent'--> world, ui    +--read each frame--> world, ui
```

An event source produces one event at a time:

```ts
interface EventSource {
  readonly header: StreamHeader;
  /** Timestamp in ns of the next event, or null when the stream has ended. */
  peek(): number | null;
  /** Produce exactly one event. The source may read state but not write it. */
  next(state: Readonly<KernelState>): KEvent;
  reset(): void;
}
```

The synthetic model keeps a private agenda, for example "the device completes
this request at t + 180 µs". That agenda is scheduling bookkeeping. Everything
a viewer can see must be in `KernelState`, and must get there through an event.

A trace source ignores `state` and returns the next recorded event.

## KernelState, Stage 1 shape

Plain objects and arrays, so that state can be serialised and compared in
tests.

| Field | Content |
|---|---|
| `now` | Sim time in ns |
| `header` | Stream header: schema version, kernel, arch, CPU count, source |
| `cpus[]` | `id`, `current` pid, `context` (`user`, `kernel`, `hardirq`, `softirq`, `idle`), `runqueue` pids |
| `tasks{}` | By pid: `comm`, `kind` (`user`, `kthread`), `state`, `cpu`, `station` |
| `pageCache{}` | By `ino:index`: `absent`, `locked`, `uptodate` |
| `blockQueues{}` | By device: requests with `sector`, `nrSectors`, `stage` |
| `flows{}` | By flow id: `kind`, `pid`, `station`, `detached`, `startedAt` |
| `counters` | Context switches, cache hits and misses, interrupts |

## Stations

A station is a named place where a task or a request can be. Stage 1 ids:
`user`, `syscall_gate`, `vfs`, `fs:ext4`, `page_cache`, `block`,
`driver:virtio_blk`, `device:vda`, `irq`, `softirq`, `runqueue:<cpu>`,
`cpu:<cpu>`.

`core/stations.ts` maps each event type to the station where it happens.
`world/layout.ts` maps each station to coordinates and each pair of adjacent
stations to a route. This table is the link between the kernel model and the
picture.

## Time model

Two clocks:

- **Sim clock.** Nanoseconds, integer, held in a JS number. Safe up to about
  104 days. It is the truth and is always shown in the HUD.
- **Presentation clock.** What the viewer watches.

Modes:

- **Event-paced (default).** Each event gets a minimum dwell on screen. Idle
  gaps are compressed to a fixed maximum, and the HUD shows how much sim time
  was skipped.
- **Time-true.** Linear mapping with a logarithmic speed slider.
- **Step.** Advance exactly one event.

The model is a discrete-event simulation. It does not use a fixed time step.
This differs from PGSimCity, which steps at 1/30 s, because kernel events are
not evenly spread.

## Bus events, Stage 1

`kevent` (one applied event), `sim:reset`, `transport` (play, pause, step,
speed, mode), `select`, `hover`, `focus`. Handlers that throw are logged and do
not stop other handlers.

## Tests

| Test | Checks |
|---|---|
| `test/sim-boundary.test.ts` | Import graph from `src/sim` and `src/core/apply.ts` reaches neither `three` nor `world`, `engine`, `ui` |
| `test/determinism.test.ts` | Same seed and scenario give an identical event stream twice |
| `test/evidence-coverage.test.ts` | Every event type has an evidence entry |
| `test/schema.test.ts` | Fixture and model output pass `validate` |
| `src/core/apply.test.ts` | State invariants: one current task per CPU, a task is on at most one runqueue, a sleeping task holds no CPU |
| Browser smoke test | Page boots, scenario reaches its last event, no console errors |

Method: write the failing test first, then the code.
