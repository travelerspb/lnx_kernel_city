# Linux Kernel City

A browser visualisation of what the Linux kernel does with data, inputs and
signals: how a user request crosses the syscall boundary, which subsystems and
drivers handle it, and where tasks and daemons run. The concept follows
[PGSimCity](https://github.com/NikolayS/PGSimCity), which does the same for
PostgreSQL.

This is a model of the kernel, not a running kernel. Mechanisms cite the
kernel source at tag `v6.18` under `evidence/`.

**Status:** Stage 1, walking skeleton. One scenario, `cold-warm-read`: a cold
`read()` that goes to the disk, then a warm `pread64()` served from the page
cache, on 4 CPUs with 3 tasks. Play, pause, step one event, reset. Every event
in the log shows its tier (T tracepoint, P function probe, S synthetic) and
links to its evidence entry.

URL parameters: `?seed=<n>` changes the model seed, `?source=fixture` plays
the hand-written fixture through the trace-replay path, `?noS` drops
synthetic events as a real trace would.

## Run

```sh
npm ci
npm test          # unit and contract tests
npm run typecheck
npm run dev       # local page
npm run build     # static bundle in dist/
npm run test:browser  # after build: headless Chrome smoke test
```

The smoke test uses the installed Google Chrome, or the binary in
`CHROME_PATH`.

Requires Node 24 or newer.

## Read in this order

| File | What it is |
|---|---|
| `docs/PLAN.md` | Stages, exit criteria, and the decisions to confirm |
| `docs/VERIFICATION.md` | Which facts behind the plan are verified and which are not |
| `docs/ARCHITECTURE.md` | Module boundaries, data flow, time model, hard rules |
| `docs/EVENT_SCHEMA.md` | Draft v0 of the kernel event contract |
| `docs/CITY_MAP.md` | The city metaphor: zones, stations, colour meaning |
| `docs/stage-1/README.md` | Stage 1 scope, work-package graph, file ownership |
| `docs/stage-1/WP*.md` | One self-contained brief per work package |
| `evidence/README.md` | Evidence entry format, read by the coverage test |

## Licence

MIT. See `LICENSE`. Evidence files cite the kernel by file and function and
never include kernel source.
