# Evidence

Every event type the model can emit, and every kernel function it names, is
backed by an entry here. An entry cites a file and a function in the Linux
kernel at the pinned tag `v6.18`, and describes the behaviour in our own words.

No kernel source is pasted here. Cite, do not copy. This keeps the kernel's
GPL-2.0 away from the project licence.

Owner: WP1. The format below was fixed by WP0 so that
`test/evidence-coverage.test.ts` can read it. Changing the format means
changing that test in the same change.

## `index.json`

```json
{
  "kernel": "v6.18",
  "events": {
    "<event type>": {
      "file": "read-path.md",
      "anchor": "sys-enter",
      "status": "verified"
    }
  },
  "functions": {
    "<kernel function name>": {
      "file": "read-path.md",
      "anchor": "vfs-read",
      "status": "verified"
    }
  }
}
```

- `events` has one key per event type in `src/core/types.ts`
  (`EVENT_TYPES`). The coverage test fails on a missing key.
- `functions` has one key per function name used in a `func_entry` or
  `func_exit` event, or in `src/core/stations.ts`.
- `file` is relative to `evidence/` and must exist.
- `anchor` is a heading anchor inside that file: the heading text in lower
  case, spaces replaced by `-`, other punctuation removed. The coverage test
  checks that a heading with that anchor exists.
- `status` is one of:
  - `verified`: read in the kernel source at `v6.18`.
  - `not-verified`: plausible, not yet checked. Must also be listed in
    `open-questions.md`.
  - `drop`: the kernel does not do this; the event or function should be
    removed or renamed. The entry text says what to use instead.

## Entry format inside a Markdown file

```markdown
## vfs_read

- Kernel: `v6.18`
- Location: `fs/read_write.c`, function `vfs_read`
- Status: verified
- Event: `func_entry` / `func_exit` with `fn: "vfs_read"`
- Station: `vfs`

What it does, in one to three sentences of our own words.
```
