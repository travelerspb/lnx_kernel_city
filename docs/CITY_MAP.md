# City map

Draft of the metaphor. `src/world/layout.ts` will be the only place with
coordinates. This file fixes meaning, not numbers.

## Accuracy rules for the metaphor

A metaphor that is easy to draw can teach the wrong thing. These rules come
first.

1. **A syscall is not a message to someone else.** The same task crosses the
   gate and continues on the kernel side. Draw the task itself walking through
   and changing colour, not a parcel handed to a clerk.
2. **A task moves only while it holds a CPU.** There are `ncpu` CPU tokens.
   A task without one stands still in a runqueue or sleeps. This makes the
   scheduler visible everywhere, not only in its own district.
3. **An interrupt borrows a CPU from whoever has it.** It arrives from the
   hardware coast and stops the task on that CPU, whatever the task was doing.
4. **Data and control are different things.** A task is a walker. A page, a
   bio, a request and a packet are cargo. Cargo can move without the task that
   asked for it, which is exactly what happens while the task sleeps on I/O.
5. **Kernel threads are residents of the kernel city.** They never go north of
   the gate.

## Zones, north to south

View is top-down. North is user space, south is hardware.

| Zone | Holds | Stage |
|---|---|---|
| Userland | Processes and daemons as buildings, grouped by session or cgroup. PID 1 at the centre. | 1 (three tasks), 2 (full) |
| Syscall gate | A wall across the map with gates. The only way south for a user task. Signals are delivered here on the way back north. | 1 |
| Kernel city | Districts below | 1 onward |
| Hardware coast | CPU cores, RAM, disk, NIC, timer, keyboard | 1 (CPU, disk) |

## Kernel city districts

| District | Kernel subsystem | Stations | Stage |
|---|---|---|---|
| Scheduler plaza | `kernel/sched` | One lane per CPU with its runqueue; the CPU token sits at the head | 1 (minimal), 2 |
| VFS quarter | `fs/` | `vfs`, `fs:ext4`; later dentry and inode caches | 1, 3 |
| Page cache warehouse | `mm/filemap.c` and friends | `page_cache`; shelves are pages, keyed by file and index | 1, 3 |
| Memory yard | Buddy and slab allocators, reclaim | Later | 3 |
| Block depot | `block/` | `block`; requests queue here before dispatch | 1, 3 |
| Driver row | `drivers/` | `driver:virtio_blk`; one building per bound driver, facing its device | 1, 4 |
| Interrupt dispatch | `kernel/irq`, `kernel/softirq.c` | `irq`, `softirq`; later workqueues | 1, 4 |
| Network district | `net/` | Later | 5 |
| Signal office | `kernel/signal.c` | Later | 4 |

Districts that belong to a later stage are drawn as labelled empty lots, so the
map does not reshuffle when they are built.

## Stage 1 route

Cold read: `user` to `syscall_gate` to `vfs` to `fs:ext4` to `page_cache`
(miss) to `block` to `driver:virtio_blk` to `device:vda`. The task goes to
sleep at `page_cache` and gives up its CPU token. The completion comes back
`device:vda` to `irq` to `softirq` to `block` to `page_cache`, which wakes the
task. The task gets a token, copies the data and returns north through
`syscall_gate`.

Warm read: `user` to `syscall_gate` to `vfs` to `fs:ext4` to `page_cache`
(hit) and back. No cargo goes south of the warehouse.

## Colour meaning

Colour encodes execution context and data state. Final values are a WP3 task.
Both light and dark themes must keep the distinctions.

| Meaning | Applies to |
|---|---|
| User mode | Task |
| Kernel mode, process context | Task |
| Hardirq context | CPU token and handler |
| Softirq context | CPU token and handler |
| Runnable, waiting for a CPU | Task |
| Sleeping | Task |
| Page absent, locked for I/O, up to date | Page |
| I/O in flight | Request cargo |

Do not rely on colour alone. Each state also has a shape or icon difference.
