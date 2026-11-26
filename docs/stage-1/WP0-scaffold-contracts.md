# WP0: scaffold and contracts

Runs first and alone. WP2, WP3 and WP4 are blocked until this is done.

## Goal

A building, tested, empty project in which the contracts exist as code: event
types, state type, reducer, runtime, bus, clocks, station table, and one
hand-written fixture stream.

## Read first

`docs/ARCHITECTURE.md`, `docs/EVENT_SCHEMA.md`, `docs/CITY_MAP.md`,
`docs/stage-1/README.md`.

## Owns

`package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`,
`src/core/**`, `src/world/layout.ts` (first version),
`test/sim-boundary.test.ts`, `test/schema.test.ts`,
`test/evidence-coverage.test.ts`, `test/fixtures/**`.

## Deliverables

1. `git init`, npm project, TypeScript strict mode, Vite, vitest. Scripts:
   `dev`, `build`, `typecheck`, `test`. Runtime dependency: `three` only.
   Pin versions; check the current ones rather than guessing.
2. `src/core/types.ts`: `StreamHeader`, `Snapshot`, `KEvent` as a
   discriminated union over the Stage 1 types, `KernelState`, `StationId`,
   `EventSource`, the bus event map.
3. `src/core/apply.ts`: the reducer for every Stage 1 event type, with unit
   tests for the invariants listed in `ARCHITECTURE.md`.
4. `src/core/runtime.ts`: pulls from an `EventSource`, applies, emits
   `kevent`. Supports run-until-time, step-one-event and reset.
5. `src/core/bus.ts`, `rng.ts`, `timebase.ts` (sim clock plus presentation
   clock with event-paced, time-true and step modes), `validate.ts`,
   `stations.ts` (event type and function name to station).
6. `src/world/layout.ts`: station ids to coordinates, routes between adjacent
   stations, district bounds. Numbers may be rough; WP3 refines them.
7. `test/fixtures/cold-warm-read.events.json`: a hand-written stream of about
   40 events for the scenario, valid under `validate`. Mark it in the header as
   hand-written. A small `FixtureSource` that implements `EventSource` over it.
8. The three tests named under Owns. `evidence-coverage` may read a list of
   event types from `evidence/index.json`; agree the format with WP1 by
   writing it down in `evidence/README.md` if WP1 has not yet done so.
9. `index.html` with an empty canvas and a line of text. No visuals.

## Acceptance

- `npm test`, `npm run typecheck`, `npm run build` pass from a clean clone.
- Running the fixture through the runtime ends with `reader` in user mode, the
  page `uptodate`, one cache miss and one cache hit in the counters.
- `sim-boundary` fails when a file under `src/sim` imports `three`. Prove it
  once by hand and say so in the report.

## Out of scope

The synthetic model, rendering, UI, CI and deploy.

## Notes

- Write each failing test before its code.
- Do not copy code from PGSimCity. Its pattern is the reference; its licence is
  Apache-2.0 and we have not decided ours.
- If a contract in the docs turns out to be wrong, fix the doc in the same
  change and list the change in the report.
