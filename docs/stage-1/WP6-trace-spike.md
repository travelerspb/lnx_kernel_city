# WP6: trace feasibility spike (optional)

Independent of the other packages. **Needs explicit approval before it runs**,
because it starts a virtual machine. See decision D7 in `docs/PLAN.md`.

## Goal

Find out, before the schema hardens, whether a real kernel can supply every
Stage 1 event type. This is a spike: the output is a report and a capture
script, not a pipeline.

## Read first

`docs/EVENT_SCHEMA.md`, `docs/VERIFICATION.md`, `evidence/read-path.md` if it
exists.

## Owns

`tools/trace/**`, `evidence/trace-feasibility.md`.

## Constraints

- Use a new, separate colima profile with a small memory size. Do not start,
  stop or change any existing colima profile; other work depends on them.
- Stop and delete only the profile this package created, when done.
- The guest will be aarch64 on this machine. Record the guest kernel version;
  it will not be 6.18. State how that limits the findings.

## Steps

1. Start the VM. Record `uname -a` and whether tracefs, BTF and bpftrace are
   available.
2. Create a file, drop the page cache, then read one page twice with a small
   program or `dd`.
3. Capture with bpftrace or `perf trace`, filtered to that process plus
   interrupt and block events: every tier `T` tracepoint and every tier `P`
   function from the schema.
4. Compare the captured order with `evidence/read-path.md`.

## Deliverables

- `tools/trace/read.bt` or equivalent, plus a short `tools/trace/README.md`
  with the exact commands.
- `evidence/trace-feasibility.md`: a table of each Stage 1 event type against
  captured or not, the hook used, the fields available, and surprises. Include
  one raw captured sequence for the cold read and one for the warm read.
- Proposed changes to `docs/EVENT_SCHEMA.md`, as a list. Do not edit the
  schema.

## Acceptance

Each Stage 1 event type is marked captured, not capturable, or not tried, with
the reason.

## Out of scope

A converter to the schema format, replay in the page, x86_64 emulation.
