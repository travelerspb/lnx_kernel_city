# WP1: evidence for the read path

Research only. No code under `src/`. Can start at once.

## Goal

A verified, cited description of what kernel `v6.18` does for the
`cold-warm-read` scenario, precise enough that WP2 can order its events from it
and that every event type has an evidence entry.

## Read first

`docs/VERIFICATION.md` (the pending items are yours), `docs/EVENT_SCHEMA.md`,
`docs/stage-1/README.md`.

## Owns

`evidence/**`, except `evidence/trace-feasibility.md`.

## Sources

Kernel source at tag `v6.18` only. Raw files:
`https://raw.githubusercontent.com/torvalds/linux/v6.18/<path>`. That host
rate-limits; space requests out. The Elixir cross-referencer pages were too
large to read through a fetch tool. A local shallow clone of the tag is the
reliable route if cloning is allowed.

Do not cite blogs, books or memory as evidence. They are fine for finding
where to look.

## Candidate chain, written from memory, every item to be checked

Entry: `entry_SYSCALL_64`, `do_syscall_64`, `x64_sys_call`, `ksys_read`,
`vfs_read`, `ext4_file_read_iter`, `generic_file_read_iter`, `filemap_read`,
`filemap_get_pages`.

Miss: `page_cache_sync_ra` and the readahead code under it, `ext4_readahead`,
`submit_bio`, `submit_bio_noacct`, `blk_mq_submit_bio`, dispatch to
`virtio_queue_rq`, `virtqueue_kick`.

Sleep: the wait on the locked folio (`folio_wait_bit_common` or its callers),
`io_schedule`, `schedule`.

Completion: `vring_interrupt`, `virtblk_done`, `blk_mq_complete_request`, the
block softirq if one is used on this path, `bio_endio`, the read completion
callback, folio unlock, `folio_wake_bit`, `try_to_wake_up`.

Return: copy to the user buffer, `sys_exit`.

Hit: `filemap_get_pages` finds an up-to-date folio and no I/O starts.

## Questions the evidence must answer

1. For each function above: does it exist at `v6.18`, in which file, and is it
   really on this path? Give the corrected chain.
2. Does a cold single-page read trigger readahead of more pages by default?
   The model reads one page. State what the kernel does and what we skip.
3. Does `virtio_blk` completion run in hardirq context, softirq context, or
   both? Which tracepoints fire, and in what order?
4. Which CPU handles the completion interrupt, and which CPU is the woken task
   placed on? State what is fixed and what depends on configuration.
5. Is the I/O scheduler bypassed for this device by default? Does
   `block_rq_insert` fire?
6. Confirm the tracepoints marked pending in `VERIFICATION.md`, with their
   field names.
7. For each tier `P` event: the function to probe.

## Deliverables

- `evidence/README.md`: the entry format.
- `evidence/index.json`: event type to evidence file and anchor. WP0's
  coverage test reads this.
- `evidence/read-path.md`: the ordered chain for cold and warm reads. Each
  step: function, file, what it does in one sentence, which schema event it
  maps to, station.
- `evidence/tracepoints.md`: each Stage 1 tracepoint with header file and
  fields.
- `evidence/open-questions.md`: anything you could not confirm.
- Update the pending rows in `docs/VERIFICATION.md`.

## Acceptance

- Every claim has a file path and function name at `v6.18`.
- Anything not confirmed is marked "not verified", never stated as fact.
- No kernel source is pasted into `evidence/`. Cite file and function, and
  describe behaviour in your own words. This keeps the kernel's GPL-2.0 away
  from the project licence.
- Every event type in `docs/EVENT_SCHEMA.md` has an entry in
  `evidence/index.json`, or a note that the type should be dropped or renamed.

## Out of scope

arm64 entry code, NVMe, network, anything outside this scenario.
