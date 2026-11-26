# WP5: integration and deploy

Runs last, after WP2, WP3 and WP4.

## Goal

Wire the model, world and UI together in `main.ts`, replace the hand-written
fixture with model output, add CI, and deploy.

## Read first

All of `docs/`, then the reports from WP0 to WP4.

## Owns

`src/main.ts`, CI and deploy configuration, the browser smoke test,
`README.md`, `test/fixtures/cold-warm-read.events.json` (regenerated).

## Deliverables

1. `src/main.ts`: boot order renderer, camera, runtime with the synthetic
   model, world, UI. Frame loop: advance the timebase, run the runtime up to
   the presentation target, update world modules, render.
2. Regenerate the fixture from the model with the default seed. Keep the
   `FixtureSource` path alive behind a URL parameter, because Stage 6 trace
   replay uses the same path.
3. Browser smoke test: the built page boots in headless Chrome, the scenario
   reaches its last event, no console errors.
4. CI on GitHub Actions, `.github/workflows/ci.yml`: fast tests, browser
   test, typecheck, build. Runs on push and pull request to `main`.
5. Deploy on GitHub Pages, `.github/workflows/pages.yml`: the same three
   jobs, then upload `dist` and deploy. Set the Vite `base` to the repository
   name, because a project page is served from a sub-path.
   **Do not create the GitHub repository or push.** The owner creates the
   remote and enables Pages; the repository name and visibility are theirs to
   choose.
6. `README.md`: what the page shows, how to run it, the statement that this is
   a model and not a running kernel, the pinned kernel version.

## Acceptance

All seven exit criteria in `docs/stage-1/README.md`.

## Out of scope

New features. If integration shows a gap in a contract, fix the contract and
its doc, and list the change in the report.

## Report (2026-11-25)

- `src/main.ts` boots bus, source, runtime, presentation clock, world, UI and
  runs the frame loop. `?source=fixture` keeps the `FixtureSource` path.
- Deviation: the fixture was **not** replaced with model output. Unit tests in
  core, world and UI pin the hand-written stream, and it is a useful second
  stream that differs from the model (wakeup inside the softirq versus
  through the wake list). The page plays the model by default. `recordSim` in
  `src/sim/record.ts` produces a model stream when one is needed on disk.
- Evidence links point at `evidence/` on GitHub
  (`travelerspb/lnx_kernel_city`, branch `main`), so the build does not copy
  the Markdown. The index is bundled.
- `ksys_pread64` added to `evidence/` (verified at `v6.18`) and to
  `stations.ts`; the model now emits it on the warm read.
- The map canvas is sized to the space left of the event log
  (`--lkc-log-w` in `src/styles/ui.css`), so the log does not cover the CPU
  lanes. The log table uses a fixed layout so the tier column always shows.
- Smoke test: `test/browser/smoke.mjs` with `playwright-core`, serving
  `dist/` under `/lnx_kernel_city/`. Checks the model, fixture and `?noS`
  runs reach their last event with one hit and one miss and no console
  errors.
- CI: `.github/workflows/ci.yml` (tests; typecheck and build; browser smoke
  on the built artifact). `pages.yml` reuses it and deploys `dist`.
- Open: the legend colours in `src/styles/ui.css` duplicate
  `src/world/palette.ts`. Frame rate not measured.
