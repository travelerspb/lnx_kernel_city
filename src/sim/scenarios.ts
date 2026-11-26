// Typed scenario definitions for the synthetic model.

import type { SnapshotDevice, SnapshotFile, SnapshotTask } from '../core/types';

/** One system call that the scenario's reader makes. `delayNs` is user-space
 *  time before the call: from stream start for the first action, from the
 *  previous action's sys_exit for the others. */
export type ScenarioAction =
  | { op: 'read'; fd: number; buf: number; count: number; delayNs: number }
  | { op: 'pread64'; fd: number; buf: number; count: number; offset: number; delayNs: number };

export interface ScenarioFile extends SnapshotFile {
  /** Descriptor the reader holds open on this file, at position 0. */
  fd: number;
  /** First 512-byte sector of the file's (contiguous) data on the device. */
  startSector: number;
}

export interface Scenario {
  name: string;
  ncpu: number;
  /** Every task at ts = 0. Running tasks name their CPU; runnable tasks name
   *  the CPU whose runqueue holds them. */
  tasks: SnapshotTask[];
  /** pid of the task that runs the script. */
  reader: number;
  file: ScenarioFile;
  device: SnapshotDevice;
  /**
   * CPUs that may take the device interrupt. With one virtio-blk queue the
   * vector's affinity mask covers all CPUs and the x86 vector code picks one
   * effective CPU; which one is not verified (evidence/open-questions.md,
   * "Effective CPU of a single-queue interrupt"). Rule of the model: at the
   * start of each stream it picks one of these with the seeded RNG and keeps
   * it for the whole stream. Illustrative.
   */
  irqCpuCandidates: number[];
  script: ScenarioAction[];
}

/**
 * docs/stage-1/README.md: 4 CPUs, reader plus two CPU-bound tasks, a small
 * file on ext4 on /dev/vda (single-queue virtio_blk), nothing cached. A cold
 * read() of page 0, then a warm pread64() of page 0 again: a second plain
 * read() would start at offset 4096 and, in the kernel, trigger async
 * readahead (evidence/read-path.md, "Warm read, in order").
 */
export const COLD_WARM_READ: Scenario = {
  name: 'cold-warm-read',
  ncpu: 4,
  tasks: [
    { pid: 100, comm: 'reader', kind: 'user', mode: 'user', state: 'running', cpu: 0 },
    { pid: 101, comm: 'busy-a', kind: 'user', mode: 'user', state: 'running', cpu: 1 },
    { pid: 102, comm: 'busy-b', kind: 'user', mode: 'user', state: 'running', cpu: 2 },
  ],
  reader: 100,
  file: { ino: 12, path: '/data/small.txt', size: 16384, fd: 3, startSector: 2048 },
  device: { dev: 'vda', driver: 'virtio_blk', irq: 25, irqName: 'virtio1-req.0' },
  // Every CPU but the reader's, as evidence/read-path.md "Interrupt CPU and
  // wakeup CPU" describes the model's choice.
  irqCpuCandidates: [1, 2, 3],
  script: [
    { op: 'read', fd: 3, buf: 4096, count: 4096, delayNs: 1_000 },
    { op: 'pread64', fd: 3, buf: 4096, count: 4096, offset: 0, delayNs: 300_000 },
  ],
};

export const SCENARIOS: Readonly<Record<string, Scenario>> = {
  [COLD_WARM_READ.name]: COLD_WARM_READ,
};
