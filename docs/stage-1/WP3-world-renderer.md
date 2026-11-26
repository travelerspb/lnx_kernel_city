# WP3: world and renderer

Starts after WP0. Works against the fixture stream, so it does not wait for
WP2.

## Goal

A top-down three.js view of the Stage 1 map that shows state and animates
events. Clarity over looks.

## Read first

`docs/CITY_MAP.md` (the accuracy rules are requirements),
`docs/ARCHITECTURE.md`, `src/core/types.ts`, `src/world/layout.ts`,
`test/fixtures/cold-warm-read.events.json`.

## Owns

`src/world/**` (including `layout.ts` from now on), `src/engine/**`.

## Must not touch

`src/core/**`, `src/sim/**`, `src/ui/**`.

## Deliverables

1. `src/engine/`: renderer, orthographic top-down camera with pan and zoom,
   resize handling, picking that emits `hover` and `select` with an entity
   reference.
2. `src/world/layout.ts`: final Stage 1 coordinates for stations, routes and
   district bounds, including empty lots for later districts.
3. District modules, each exporting `create(scene)` and
   `update(state, presentationTime)`: userland, syscall gate, scheduler plaza
   with one lane per CPU, VFS quarter, page cache warehouse, block depot,
   driver row, interrupt dispatch, hardware coast.
4. Entities: tasks as walkers, CPU tokens, pages, block requests as cargo.
   State is read from `KernelState`. Position between stations is animated on
   the presentation clock, driven by `kevent`.
5. Labels for districts and stations. Level of detail is not needed yet.
6. A colour and shape table in one file, covering every row of the colour
   table in `CITY_MAP.md`, for light and dark themes.

## Acceptance

- Playing the fixture shows: the task crossing the gate and changing context
  colour, the cache miss, cargo going to the device while the task stands
  still without a CPU token, the interrupt taking a CPU from another task, the
  wakeup, the return. The warm read visibly stops at the warehouse.
- The world never writes to state. No module under `src/world` or
  `src/engine` imports `src/sim`.
- Removing all tier `S` events from the fixture still renders without errors.
- Resetting the runtime returns every entity to its start position.
- Holds 60 frames per second for this scene on a laptop. State the measured
  figure in the report.

## Out of scope

3D camera modes, particles for decoration, audio, the tour, UI panels.

## Notes

- Coordinates appear only in `layout.ts`.
- Check the three.js version in `package.json` and read its documentation for
  that version before using an API.

## Report (WP3)

Entry: `createWorld(canvas, bus, getState, { theme?, moveMs? })` in
`src/world/index.ts` returns `{ update(dtMs, progress?), resize(w, h),
setTheme('light' | 'dark' | 'auto'), fit(), dispose() }`. `update` also
renders. Clicks emit `select`, pointer moves emit `hover`; the world listens
to `kevent`, `sim:reset`, `select` and `focus`.

Dev harness: `startDev(canvas)` in `src/world/dev.ts` plays the WP0 fixture
(space, right arrow, `r`, `t` theme, `m` mode; `?noS` drops tier S events;
fps logged every 2 s and kept in `window.__lkcFps`).

Pure, tested modules: `view.ts` (state to looks and anchor points),
`motion.ts` (route interpolation, the CPU rule for walking), `palette.ts`
(colour and shape table, contrast in both themes), `engine/cameraMath.ts`.
`scene.test.ts` drives the full scene graph and picking without WebGL.

Contract gaps for `src/core`: `Selection` has no `cpu`, `page` or `request`
kinds (the world sends `station` `cpu:N` / `page_cache`, or the request's
flow). The legend table lives in `src/world/palette.ts`, which WP4 may not
import.

Limitations: the plaza fits 4 CPU lanes; districts are not rebuilt if a
reset brings a different stream header; frame rate was not measured in a
browser (the CPU side of one frame is about 0.01 ms for 256 objects in node).
