// What each thing on the map is. One entry per zone, district, station and
// state, written for a viewer who knows programming but not kernel internals.
//
// The UI shows `summary` as a tooltip and the rest in the inspector. The world
// may use `title`. Both import this file; it imports nothing.
//
// Accuracy rules (docs/CITY_MAP.md) apply to the text as much as to the
// drawing. Kernel claims cite evidence/ where an entry exists; text about
// later stages says so. test/glossary.test.ts checks that every zone,
// district and station has an entry and that every evidence link resolves.

export type InfoKind =
  | 'zone' | 'district' | 'station' | 'task' | 'task-kind' | 'task-state'
  | 'cpu-context' | 'page-state' | 'cargo' | 'tier';

export interface EvidenceRef {
  /** Relative to evidence/. */
  file: string;
  anchor: string;
}

export interface InfoEntry {
  id: string;
  kind: InfoKind;
  title: string;
  /** One line. Tooltip text. */
  summary: string;
  /** A short paragraph: what it is and what it does. */
  body: string;
  /** What to watch for in the cold-warm-read scenario. */
  inScenario?: string;
  /** Kernel source locations at v6.18, as paths. */
  source?: string[];
  evidence?: EvidenceRef[];
  /** Other glossary ids worth reading next. */
  related?: string[];
  /** Stage that builds it, when later than Stage 1. */
  stage?: number;
}

const RP = 'read-path.md';
const TP = 'tracepoints.md';
const ev = (file: string, anchor: string): EvidenceRef => ({ file, anchor });

const ENTRIES: InfoEntry[] = [
  // -------------------------------------------------------------- zones
  {
    id: 'zone:userland',
    kind: 'zone',
    title: 'User Code',
    summary: 'User code (user space, also called userland): where ordinary programs run, without direct access to hardware or kernel memory.',
    body:
      'Every program you start (a shell, cat, a web server, a daemon) runs here, in the CPU\'s unprivileged mode. ' +
      'Each process has its own address space and cannot touch another process\'s memory, the kernel\'s data or any device. ' +
      'To do anything beyond computing on its own memory, such as reading a file, it must ask the kernel through a system call.',
    inScenario:
      'Three processes live here: reader, busy-a and busy-b. busy-a and busy-b only compute, so they never leave. ' +
      'reader calls read() and pread64(), and each call takes it south through the syscall gate.',
    related: ['zone:gate', 'task-kind:user', 'cpu-context:user'],
  },
  {
    id: 'zone:gate',
    kind: 'zone',
    title: 'Syscall gate',
    summary: 'The boundary between user space and the kernel. The only way south for a user task is a system call.',
    body:
      'A system call is a special CPU instruction (syscall on x86_64) that switches the CPU to privileged mode and jumps to a fixed kernel entry point. ' +
      'The same task keeps running: it is not a message to someone else. The task now executes kernel code on its own kernel stack, and returns north when the call finishes.',
    inScenario:
      'Watch reader cross the gate twice. Its shape changes from circle to diamond while it runs kernel code. sys_enter marks the crossing south, sys_exit the return.',
    source: ['arch/x86/entry/entry_64.S', 'arch/x86/entry/syscall_64.c'],
    evidence: [ev(RP, 'entry-syscall-64'), ev(RP, 'do-syscall-64'), ev(TP, 'sys-enter'), ev(TP, 'sys-exit')],
    related: ['station:syscall_gate', 'cpu-context:kernel'],
  },
  {
    id: 'zone:kernel',
    kind: 'zone',
    title: 'Kernel city',
    summary: 'Kernel space: privileged code shared by all processes, split into subsystems.',
    body:
      'The kernel is one program with one address space, shared by every task that enters it. ' +
      'Its code runs in two kinds of context: process context, on behalf of a task that made a system call (that task can sleep), ' +
      'and interrupt context, borrowed from whatever task was on the CPU when hardware asked for attention (no sleeping allowed). ' +
      'Each district is one subsystem.',
    inScenario:
      'reader walks through the VFS quarter and the page cache in process context. The completion comes back through interrupt dispatch in interrupt context, while reader sleeps.',
    evidence: [ev(RP, 'interrupt-and-softirq-context')],
    related: ['cpu-context:kernel', 'cpu-context:hardirq', 'cpu-context:softirq', 'task-kind:kthread'],
  },
  {
    id: 'zone:hardware',
    kind: 'zone',
    title: 'Hardware coast',
    summary: 'CPU cores and devices. Devices work on their own and report back with interrupts.',
    body:
      'CPU cores execute code; each runs exactly one thing at a time. Devices such as the disk work in parallel with the CPUs: ' +
      'the kernel hands them work through queues in memory, and they raise an interrupt when they finish. ' +
      'Lots for RAM, the NIC, the timer and the keyboard are reserved for later stages.',
    inScenario:
      'Four CPU cores sit on the coast. The disk vda receives the read request, works for about 150 µs of model time (an illustrative figure), then interrupts one CPU.',
    related: ['station:cpu', 'station:device:vda'],
  },

  // ---------------------------------------------------------- districts
  {
    id: 'district:scheduler',
    kind: 'district',
    title: 'Scheduler plaza',
    summary: 'Decides which task runs on each CPU. One lane per CPU with its queue of runnable tasks.',
    body:
      'Each CPU has a runqueue of tasks that are ready to run. When the running task sleeps, finishes its time slice or is preempted, ' +
      'the scheduler picks the next one; for normal tasks the policy is EEVDF. A sleeping task is on no runqueue. ' +
      'Waking it up puts it back on the runqueue of a CPU the scheduler chooses.',
    inScenario:
      'When reader waits for the disk it gives up CPU 0, which goes idle. After the completion wakes reader, it is queued on a CPU and the next context switch gives it the CPU back. ' +
      'Stage 1 has no timer tick, so no task is preempted for running too long.',
    source: ['kernel/sched/core.c', 'kernel/sched/fair.c'],
    evidence: [ev(RP, 'interrupt-cpu-and-wakeup-cpu'), ev(TP, 'sched-switch'), ev(TP, 'sched-wakeup')],
    related: ['station:runqueue', 'station:cpu', 'task-state:runnable'],
  },
  {
    id: 'district:vfs',
    kind: 'district',
    title: 'VFS quarter',
    summary: 'The Virtual File System: one interface for files, whatever filesystem holds them.',
    body:
      'A program reads a file descriptor; it does not know whether the file lives on ext4, XFS, NFS or in /proc. ' +
      'The VFS turns the descriptor into an open file and calls that filesystem\'s own read method. ' +
      'It also keeps the file position, which is why two plain read() calls read consecutive parts of a file.',
    inScenario:
      'reader passes ksys_read (or ksys_pread64), vfs_read and new_sync_read, then hands over to ext4.',
    source: ['fs/read_write.c'],
    evidence: [ev(RP, 'ksys-read'), ev(RP, 'vfs-read'), ev(RP, 'ksys-pread64')],
    related: ['station:vfs', 'station:fs:ext4'],
  },
  {
    id: 'district:page_cache',
    kind: 'district',
    title: 'Page cache warehouse',
    summary: 'File contents cached in RAM, page by page, so repeated reads do not touch the disk.',
    body:
      'Every regular file read goes through the page cache. It holds file data in memory in units called folios (one or more 4 KiB pages), ' +
      'indexed by file and offset. On a miss the kernel allocates a folio, inserts it locked, and asks the filesystem to fill it from disk. ' +
      'Readers wait on the lock; completion marks it up to date and unlocks it.',
    inScenario:
      'The shelf slots are pages of the file. Slot 0 goes from absent to locked on the cold read and to up to date when the disk finishes. ' +
      'The warm read finds it up to date and stops here: no I/O at all.',
    source: ['mm/filemap.c', 'mm/readahead.c'],
    evidence: [ev(RP, 'filemap-read'), ev(RP, 'filemap-get-pages'), ev(RP, 'readahead-on-a-cold-read'), ev(TP, 'page-cache-lookup')],
    related: ['station:page_cache', 'page-state:absent', 'page-state:locked', 'page-state:uptodate'],
  },
  {
    id: 'district:block',
    kind: 'district',
    title: 'Block depot',
    summary: 'The block layer: turns filesystem reads into requests a disk driver can execute.',
    body:
      'A filesystem describes I/O as a bio: which sectors, into which memory. The block layer merges bios into requests, ' +
      'may hold them briefly in a plug or an I/O scheduler to batch them, and dispatches them to the driver\'s hardware queues (blk-mq). ' +
      'On completion it ends each bio, which calls back into the filesystem.',
    inScenario:
      'One bio for sector 2048 is queued, inserted through the mq-deadline scheduler, and issued to virtio_blk. It comes back through block_rq_complete in the softirq.',
    source: ['block/blk-core.c', 'block/blk-mq.c', 'block/mq-deadline.c'],
    evidence: [ev(RP, 'submit-bio'), ev(RP, 'blk-mq-submit-bio'), ev(RP, 'io-scheduler-and-block-rq-insert'), ev(TP, 'block-rq-complete')],
    related: ['station:block', 'cargo:request', 'district:drivers'],
  },
  {
    id: 'district:drivers',
    kind: 'district',
    title: 'Driver row',
    summary: 'Device drivers: code that knows how to talk to one kind of hardware.',
    body:
      'A driver translates generic kernel requests into the commands of a specific device, and handles that device\'s interrupts. ' +
      'Each bound driver is a building facing its device. More drivers, and how they get bound to devices, come in Stage 4.',
    inScenario:
      'virtio_blk is the driver for the virtual disk vda. It places the request in a virtqueue shared with the hypervisor and notifies the device.',
    source: ['drivers/block/virtio_blk.c', 'drivers/virtio/virtio_ring.c'],
    evidence: [ev(RP, 'virtio-queue-rq'), ev(RP, 'virtqueue-notify'), ev(RP, 'virtblk-done')],
    related: ['station:driver:virtio_blk', 'station:device:vda'],
  },
  {
    id: 'district:interrupts',
    kind: 'district',
    title: 'Interrupt dispatch',
    summary: 'Where hardware interrupts are handled, and where their deferred work (softirqs) runs.',
    body:
      'An interrupt stops whatever a CPU is doing and runs a short handler in hardirq context. ' +
      'Handlers do the minimum and defer the rest to a softirq, which runs soon after on the same CPU, still without a task of its own. ' +
      'Neither may sleep. Threaded IRQs and workqueues, which can sleep, come in Stage 4.',
    inScenario:
      'The disk interrupt lands on one CPU and borrows it from the task running there. The handler raises the BLOCK softirq, which completes the request, marks the page up to date and wakes reader.',
    source: ['kernel/irq/handle.c', 'kernel/softirq.c'],
    evidence: [ev(RP, 'interrupt-and-softirq-context'), ev(TP, 'irq-handler-entry'), ev(TP, 'softirq-entry')],
    related: ['station:irq', 'station:softirq', 'cpu-context:hardirq', 'cpu-context:softirq'],
  },
  {
    id: 'district:memory',
    kind: 'district',
    title: 'Memory yard',
    summary: 'Physical memory allocators and reclaim. Built in Stage 3.',
    body:
      'The buddy allocator hands out physical pages; slab caches carve them into small kernel objects. ' +
      'When memory runs short, reclaim and kswapd evict cached pages, and as a last resort the OOM killer ends a process.',
    inScenario: 'Empty lot. The one page allocation in this scenario shows as an mm_page_alloc event at the page cache.',
    source: ['mm/page_alloc.c', 'mm/slub.c', 'mm/vmscan.c'],
    evidence: [ev(TP, 'mm-page-alloc')],
    stage: 3,
  },
  {
    id: 'district:network',
    kind: 'district',
    title: 'Network district',
    summary: 'Sockets, TCP/IP, packet filtering and network drivers. Built in Stage 5.',
    body:
      'Data written to a socket goes through the protocol stack, the queueing discipline and the NIC driver. ' +
      'Incoming packets arrive by interrupt and are processed by NAPI polling in softirq context.',
    inScenario: 'Empty lot.',
    source: ['net/'],
    stage: 5,
  },
  {
    id: 'district:signals',
    kind: 'district',
    title: 'Signal office',
    summary: 'Signal generation and delivery, such as Ctrl-C. Built in Stage 4.',
    body:
      'A signal is a notification sent to a process. The kernel records it as pending and delivers it when the target task next returns to user space, at the syscall gate.',
    inScenario: 'Empty lot.',
    source: ['kernel/signal.c'],
    stage: 4,
  },

  // ----------------------------------------------------------- stations
  {
    id: 'station:user',
    kind: 'station',
    title: 'User code',
    summary: 'A task here is running its own program in user mode.',
    body: 'The home of a user task. While here it computes on its own memory and needs nothing from the kernel.',
    related: ['zone:userland'],
  },
  {
    id: 'station:syscall_gate',
    kind: 'station',
    title: 'Syscall gate',
    summary: 'Entry and exit of system calls. Data is also copied to the user buffer here.',
    body:
      'sys_enter fires as the call is dispatched and sys_exit as it returns. Before returning, read copies the data from the page cache into the buffer the program passed; ' +
      'that copy is the copy_to_user event.',
    source: ['arch/x86/entry/syscall_64.c', 'lib/iov_iter.c'],
    evidence: [ev(TP, 'sys-enter'), ev(TP, 'sys-exit'), ev(TP, 'copy-to-user')],
    related: ['zone:gate'],
  },
  {
    id: 'station:vfs',
    kind: 'station',
    title: 'vfs_read',
    summary: 'Generic file read: checks the file and calls the filesystem.',
    body: 'Checks that the file is open for reading and the range is valid, then calls the filesystem\'s read method.',
    source: ['fs/read_write.c'],
    evidence: [ev(RP, 'vfs-read'), ev(RP, 'new-sync-read')],
    related: ['district:vfs'],
  },
  {
    id: 'station:fs:ext4',
    kind: 'station',
    title: 'ext4',
    summary: 'The ext4 filesystem: maps file offsets to disk blocks.',
    body:
      'For a plain buffered read ext4 passes straight to the generic page cache code. ' +
      'It comes back into play on a miss, when readahead asks it which disk blocks hold the missing pages and it builds the bio.',
    inScenario: 'reader visits twice on the cold read: once on the way in, and again when ext4_readahead builds the bio.',
    source: ['fs/ext4/file.c', 'fs/ext4/readpage.c'],
    evidence: [ev(RP, 'ext4-file-read-iter'), ev(RP, 'ext4-readahead'), ev(RP, 'ext4-mpage-readpages')],
    related: ['district:vfs', 'district:page_cache'],
  },
  {
    id: 'station:page_cache',
    kind: 'station',
    title: 'Page cache lookup',
    summary: 'Looks the page up in the cache; on a miss, starts reading it and waits.',
    body:
      'filemap_read looks the requested pages up. On a hit it copies at once. On a miss it starts readahead and then waits on the folio lock, ' +
      'putting the task to sleep until the read completes.',
    inScenario: 'reader falls asleep here on the cold read, in state D, and stays here until the completion wakes it.',
    source: ['mm/filemap.c'],
    evidence: [ev(RP, 'filemap-get-read-batch'), ev(RP, 'folio-wait-bit-common'), ev(TP, 'page-cache-lookup')],
    related: ['district:page_cache', 'task-state:sleeping'],
  },
  {
    id: 'station:block',
    kind: 'station',
    title: 'Block layer',
    summary: 'Queues, schedules and completes block I/O requests.',
    body: 'Where bios become requests on the way down, and where requests are completed on the way back up.',
    source: ['block/blk-mq.c'],
    evidence: [ev(TP, 'block-bio-queue'), ev(TP, 'block-rq-insert'), ev(TP, 'block-rq-complete')],
    related: ['district:block', 'cargo:request'],
  },
  {
    id: 'station:driver:virtio_blk',
    kind: 'station',
    title: 'virtio_blk driver',
    summary: 'Driver for a virtual disk provided by the hypervisor.',
    body:
      'virtio is a standard interface between a virtual machine and its hypervisor. The driver puts each request in a shared ring (a virtqueue) and notifies the device; ' +
      'the device puts the result back and interrupts.',
    source: ['drivers/block/virtio_blk.c'],
    evidence: [ev(RP, 'virtio-queue-rq'), ev(TP, 'block-rq-issue'), ev(RP, 'virtblk-done')],
    related: ['district:drivers'],
  },
  {
    id: 'station:device:vda',
    kind: 'station',
    title: 'Disk vda',
    summary: 'The virtual disk. Works on the request by itself; no CPU is involved.',
    body:
      'Between the notify and the interrupt the device works alone, so the kernel has no event for it. The model shows that time with two synthetic (tier S) events.',
    inScenario: 'While the request is here, reader sleeps and the CPUs run other tasks or idle.',
    evidence: [ev(TP, 'hw-io-start'), ev(TP, 'hw-io-done')],
    related: ['tier:S', 'zone:hardware'],
  },
  {
    id: 'station:irq',
    kind: 'station',
    title: 'Hardirq handler',
    summary: 'Interrupt handler: runs at once on the interrupted CPU, cannot sleep.',
    body:
      'For virtio_blk the handler is vring_interrupt, which calls virtblk_done. With a single hardware queue it only raises the BLOCK softirq and returns.',
    source: ['drivers/virtio/virtio_ring.c', 'block/blk-mq.c'],
    evidence: [ev(RP, 'vring-interrupt'), ev(RP, 'blk-mq-raise-softirq'), ev(TP, 'irq-handler-entry')],
    related: ['cpu-context:hardirq', 'district:interrupts'],
  },
  {
    id: 'station:softirq',
    kind: 'station',
    title: 'BLOCK softirq',
    summary: 'Deferred interrupt work: completes the request and wakes the waiting task.',
    body:
      'Runs right after the hardirq on the same CPU. blk_done_softirq completes the request; the end of the bio marks the page up to date and unlocks it, which wakes every task waiting on that page.',
    source: ['kernel/softirq.c', 'block/blk-mq.c'],
    evidence: [ev(RP, 'blk-done-softirq'), ev(RP, 'folio-end-read'), ev(TP, 'softirq-entry')],
    related: ['cpu-context:softirq', 'district:interrupts'],
  },
  {
    id: 'station:runqueue',
    kind: 'station',
    title: 'Runqueue',
    summary: 'Tasks ready to run on this CPU, waiting for their turn.',
    body: 'A task in the lane is runnable: it has everything it needs except a CPU. The scheduler takes the next one when the CPU becomes free.',
    evidence: [ev(TP, 'sched-wakeup')],
    related: ['district:scheduler', 'task-state:runnable'],
  },
  {
    id: 'station:cpu',
    kind: 'station',
    title: 'CPU core',
    summary: 'Runs one thing at a time: a task, an interrupt handler, or nothing (idle).',
    body:
      'The colour of the core shows its context: user code, kernel code for a task, hardirq, softirq or idle. ' +
      'A task can move only while it holds a CPU. An interrupt borrows the core from whoever has it and gives it back.',
    evidence: [ev(TP, 'sched-switch')],
    related: ['cpu-context:user', 'cpu-context:kernel', 'cpu-context:hardirq', 'cpu-context:softirq', 'cpu-context:idle'],
  },

  // ---------------------------------------------------------- task kinds
  // -------------------------------------------------- scenario tasks
  // Keyed by comm. The cold-warm-read scenario (src/sim/scenarios.ts).
  {
    id: 'task:reader',
    kind: 'task',
    title: 'reader',
    summary: 'The program under study: it reads one small file twice.',
    body:
      'reader opens /data/small.txt (inode 12) and reads its first 4 KiB page twice: first with read(), then again with pread64() at offset 0. ' +
      'It is the only task in this scenario that makes system calls, so it is the only one that crosses the syscall gate into Kernel city.',
    inScenario:
      'The first read is cold: the page is not in the page cache, so the kernel sends a request to the disk and reader sleeps (state D) until the disk interrupt completes it. ' +
      'The second read is warm: the page is already cached and up to date, so reader copies it and returns without any disk I/O.',
    related: ['task-kind:user', 'zone:gate', 'district:page_cache', 'task-state:sleeping'],
  },
  {
    id: 'task:busy-a',
    kind: 'task',
    title: 'busy-a',
    summary: 'A background program that only computes. It never makes a system call.',
    body:
      'busy-a runs a pure compute loop in user mode on its own CPU. It never asks the kernel for anything, so it stays in User Code for the whole scenario.',
    inScenario:
      'It keeps a CPU busy, so when the disk finishes, the interrupt may land on busy-a\'s CPU. The kernel then runs the interrupt handler on that CPU, in interrupt context, ' +
      'without switching tasks: busy-a is still the current task there, which is why the log shows interrupt events under busy-a.',
    related: ['task-kind:user', 'district:interrupts', 'task:busy-b'],
  },
  {
    id: 'task:busy-b',
    kind: 'task',
    title: 'busy-b',
    summary: 'A second background program that only computes. It never makes a system call.',
    body:
      'busy-b is a copy of busy-a on another CPU: a pure compute loop in user mode that never enters the kernel on its own.',
    inScenario:
      'It occupies a second CPU, so the machine is not idle apart from reader. Like busy-a, it can be interrupted by the disk completion, which then runs on its CPU while it stays the current task.',
    related: ['task-kind:user', 'district:interrupts', 'task:busy-a'],
  },
  {
    id: 'task-kind:user',
    kind: 'task-kind',
    title: 'User task',
    summary: 'A thread of a user program. Runs in user mode, and in kernel mode during system calls.',
    body: 'Drawn as a circle in user mode and a diamond while it runs kernel code.',
    related: ['zone:userland', 'zone:gate'],
  },
  {
    id: 'task-kind:kthread',
    kind: 'task-kind',
    title: 'Kernel thread',
    summary: 'A task that exists only inside the kernel, such as kswapd or a worker. Never goes north of the gate.',
    body: 'Kernel threads have no user address space. They do background work that can sleep. They appear in Stage 2.',
    stage: 2,
  },

  // --------------------------------------------------------- task states
  {
    id: 'task-state:running',
    kind: 'task-state',
    title: 'Running',
    summary: 'Holds a CPU and is executing.',
    body: 'Exactly one task, or the idle task, is current on each CPU.',
  },
  {
    id: 'task-state:runnable',
    kind: 'task-state',
    title: 'Runnable',
    summary: 'Ready to run, waiting on a runqueue for a CPU.',
    body: 'A runnable task stands still in its CPU\'s lane until the scheduler switches to it.',
    related: ['station:runqueue'],
  },
  {
    id: 'task-state:sleeping',
    kind: 'task-state',
    title: 'Sleeping',
    summary: 'Waiting for an event. Holds no CPU and is on no runqueue.',
    body:
      'S is an interruptible sleep: a signal can wake it. D is an uninterruptible sleep, used while waiting for I/O; only the event itself wakes the task. ' +
      'Tasks in D count towards the load average.',
    inScenario: 'reader sleeps in D at the page cache while the disk works.',
    evidence: [ev(RP, 'io-schedule')],
  },

  // -------------------------------------------------------- CPU contexts
  {
    id: 'cpu-context:user',
    kind: 'cpu-context',
    title: 'User mode',
    summary: 'The CPU runs a program\'s own code, unprivileged.',
    body: 'The normal state of a computing program.',
  },
  {
    id: 'cpu-context:kernel',
    kind: 'cpu-context',
    title: 'Kernel mode, process context',
    summary: 'The CPU runs kernel code on behalf of the current task, which may sleep.',
    body: 'Entered through a system call or a fault. The kernel knows which task it is working for, and can put that task to sleep.',
  },
  {
    id: 'cpu-context:hardirq',
    kind: 'cpu-context',
    title: 'Hardirq',
    summary: 'The CPU runs an interrupt handler. The interrupted task is frozen; nothing may sleep.',
    body: 'Handlers must be short, because the interrupted work waits and further interrupts on the line are held off.',
  },
  {
    id: 'cpu-context:softirq',
    kind: 'cpu-context',
    title: 'Softirq',
    summary: 'The CPU runs deferred interrupt work, still borrowed from the current task; no sleeping.',
    body: 'Softirqs run on interrupt exit or in the ksoftirqd thread when there is too much of them. There are ten fixed kinds, such as TIMER, NET_RX and BLOCK.',
  },
  {
    id: 'cpu-context:idle',
    kind: 'cpu-context',
    title: 'Idle',
    summary: 'No task wants this CPU. It runs the idle task (pid 0) and waits for an interrupt.',
    body: 'An idle CPU is the cheapest place to put a woken task.',
  },

  // --------------------------------------------------------- page states
  {
    id: 'page-state:absent',
    kind: 'page-state',
    title: 'Absent',
    summary: 'This part of the file is not in memory. Reading it needs the disk.',
    body: 'The shelf slot is empty.',
  },
  {
    id: 'page-state:locked',
    kind: 'page-state',
    title: 'Locked for I/O',
    summary: 'In the cache but not filled yet. Readers wait on the lock.',
    body: 'A new folio is inserted locked, so nobody can read half-filled data. The read completion unlocks it.',
    evidence: [ev(TP, 'mm-filemap-add-to-page-cache'), ev(RP, 'filemap-add-folio')],
  },
  {
    id: 'page-state:uptodate',
    kind: 'page-state',
    title: 'Up to date',
    summary: 'In the cache and valid. Reads are served from memory.',
    body: 'Stays until the kernel reclaims the memory or the file changes.',
    evidence: [ev(TP, 'folio-end-read')],
  },

  // -------------------------------------------------------------- cargo
  {
    id: 'cargo:request',
    kind: 'cargo',
    title: 'I/O request',
    summary: 'The work of one read, moving through the block layer and the device without its task.',
    body:
      'A task is a walker; a request is cargo. Once the bio is submitted the request travels on while its task sleeps. ' +
      'Interrupt handlers move the cargo, never the task they interrupted.',
    related: ['district:block', 'station:device:vda'],
  },

  // -------------------------------------------------------------- tiers
  {
    id: 'tier:T',
    kind: 'tier',
    title: 'Tier T: tracepoint',
    summary: 'A fixed kernel tracepoint. A real trace records exactly this event.',
    body: 'Tracepoints are stable hooks the kernel developers placed on purpose. Field names follow the tracepoint format.',
    evidence: [ev(TP, 'tier-t')],
  },
  {
    id: 'tier:P',
    kind: 'tier',
    title: 'Tier P: function probe',
    summary: 'Entry or return of a named kernel function, recorded with fentry or kprobe.',
    body: 'Used where no tracepoint exists. Function names can change between kernel versions; these are checked against v6.18.',
    evidence: [ev(TP, 'tier-p')],
  },
  {
    id: 'tier:S',
    kind: 'tier',
    title: 'Tier S: synthetic',
    summary: 'No kernel hook exists. The model adds it, usually for something the hardware does.',
    body: 'A real trace will not contain these. The page must make sense without them; try ?noS.',
    evidence: [ev(TP, 'tier-s')],
  },
];

export const GLOSSARY: Readonly<Record<string, InfoEntry>> = Object.fromEntries(ENTRIES.map((e) => [e.id, e]));

export function info(id: string): InfoEntry | undefined {
  return GLOSSARY[id];
}

/** Entry for a station id. Per-CPU stations share one entry, titled with the CPU. */
export function stationInfo(station: string): InfoEntry | undefined {
  const m = /^(runqueue|cpu):(\d+)$/.exec(station);
  if (m) {
    const base = GLOSSARY[`station:${m[1]}`];
    return base && { ...base, id: `station:${station}`, title: `${base.title} ${m[2]}` };
  }
  return GLOSSARY[`station:${station}`];
}
