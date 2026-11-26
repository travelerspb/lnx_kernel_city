# WP4: UI shell

Starts after WP0. Works against the fixture stream.

## Goal

The controls and panels around the canvas: transport, event log, inspector,
legend. Plain DOM and CSS, no framework.

## Read first

`docs/ARCHITECTURE.md` (bus events, time model), `docs/EVENT_SCHEMA.md`,
`src/core/types.ts`.

## Owns

`src/ui/**`, `src/styles/**`.

## Must not touch

`src/core/**`, `src/sim/**`, `src/world/**`, `src/engine/**`. The UI reaches
the world only through the bus.

## Deliverables

1. Transport bar: play, pause, step one event, reset, speed, and the mode
   switch between event-paced and time-true. Emits `transport`.
2. Clock readout: sim time with a sensible unit (ns, µs, ms), and in
   event-paced mode a visible note of how much sim time was skipped.
3. Event log: one row per applied event with time, CPU, task, type, tier
   badge, short text, and a link to the evidence entry from
   `evidence/index.json`. The current event is highlighted. Clicking a row
   emits `focus` for its station. Filter by flow.
4. Inspector: on `select`, show the entity's fields from `KernelState` (task,
   CPU, page, request).
5. Legend: the colour and shape meanings.
6. Keyboard: space for play and pause, right arrow for step, `r` for reset.
7. Light and dark themes. Usable at phone width with the log collapsed.

## Acceptance

- Unit tests for the log formatter and the clock unit formatting.
- With the fixture: step advances exactly one row; reset empties the log;
  every row has a working evidence link or a visible "no evidence" marker.
- No module under `src/ui` imports `three` or `src/world`.

## Out of scope

Command palette, guided tour, scenario picker (one scenario exists), settings.
