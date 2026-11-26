// Pure text formatting for the UI: sim time, task names, one-line event text.
// No DOM here, so vitest can test it in the node environment.

import { SOFTIRQ, type KEvent, type KernelState } from '../core/types';

const UNITS: ReadonlyArray<{ limit: number; div: number; unit: string }> = [
  { limit: 1e3, div: 1, unit: 'ns' },
  { limit: 1e6, div: 1e3, unit: 'µs' },
  { limit: 1e9, div: 1e6, unit: 'ms' },
  { limit: Infinity, div: 1e9, unit: 's' },
];

/**
 * Sim time with a sensible unit. Below 1 µs whole ns; above, three decimals
 * of the largest unit that keeps the value at or above 1.
 * 999 -> "999 ns", 1500 -> "1.500 µs", 2_000_000 -> "2.000 ms".
 */
export function formatNs(ns: number): string {
  if (!Number.isFinite(ns)) return '—';
  const sign = ns < 0 ? '-' : '';
  const abs = Math.abs(ns);
  for (const u of UNITS) {
    if (abs < u.limit) {
      if (u.div === 1) return `${sign}${Math.round(abs)} ns`;
      return `${sign}${(abs / u.div).toFixed(3)} ${u.unit}`;
    }
  }
  return `${sign}${(abs / 1e9).toFixed(3)} s`;
}

/** Exact integer ns with thin-space digit groups: 1234567 -> "1 234 567 ns". */
export function formatNsExact(ns: number): string {
  if (!Number.isFinite(ns)) return '—';
  const sign = ns < 0 ? '-' : '';
  const digits = String(Math.round(Math.abs(ns)));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${grouped} ns`;
}

/** Name of a task as the log shows it: "reader(100)", idle as "swapper/<cpu>". */
export function taskName(state: Readonly<KernelState> | null, pid: number, cpu?: number): string {
  if (pid === 0) return cpu === undefined ? 'idle(0)' : `swapper/${cpu}(0)`;
  const t = state?.tasks[pid];
  return t ? `${t.comm}(${pid})` : `pid ${pid}`;
}

const SOFTIRQ_NAMES: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(SOFTIRQ).map(([name, vec]) => [vec, name]),
);

export function softirqName(vec: number): string {
  return SOFTIRQ_NAMES[vec] ?? `vec ${vec}`;
}

/** One short line describing what the event says, without envelope fields. */
export function describeEvent(ev: KEvent, state: Readonly<KernelState> | null): string {
  switch (ev.type) {
    case 'sys_enter':
      return `${ev.name}(${ev.args.join(', ')})`;
    case 'sys_exit':
      return `${ev.name} = ${ev.ret}`;
    case 'func_entry':
      return `→ ${ev.fn}`;
    case 'func_exit':
      return ev.ret === undefined ? `← ${ev.fn}` : `← ${ev.fn} = ${ev.ret}`;
    case 'page_cache_lookup':
      return `ino ${ev.ino} page ${ev.index}: ${ev.hit ? 'hit' : 'miss'}`;
    case 'mm_page_alloc':
      return `order ${ev.order} (${2 ** ev.order} page${ev.order === 0 ? '' : 's'})`;
    case 'mm_filemap_add_to_page_cache':
      return `ino ${ev.ino} page ${ev.index} added, locked`;
    case 'folio_end_read':
      return `ino ${ev.ino} page ${ev.index}: ${ev.ok ? 'up to date, unlocked' : 'read failed'}`;
    case 'block_bio_queue':
    case 'block_rq_insert':
    case 'block_rq_issue':
      return `${ev.dev} sector ${ev.sector} + ${ev.nrSectors}`;
    case 'block_rq_complete':
      return `${ev.dev} sector ${ev.sector} + ${ev.nrSectors}${ev.error === 0 ? '' : ` error ${ev.error}`}`;
    case 'hw_io_start':
      return `${ev.dev} starts sector ${ev.sector}`;
    case 'hw_io_done':
      return `${ev.dev} done sector ${ev.sector}`;
    case 'irq_handler_entry':
      return `irq ${ev.irq} ${ev.name}`;
    case 'irq_handler_exit':
      return `irq ${ev.irq} ${ev.ret === 1 ? 'handled' : `ret ${ev.ret}`}`;
    case 'softirq_raise':
    case 'softirq_entry':
    case 'softirq_exit':
      return softirqName(ev.vec);
    case 'sched_waking':
    case 'sched_wakeup':
      return `${taskName(state, ev.wakee)} on cpu ${ev.targetCpu}`;
    case 'sched_switch':
      return `${taskName(state, ev.prevPid, ev.cpu)} [${ev.prevState}] → ${taskName(state, ev.nextPid, ev.cpu)}`;
    case 'copy_to_user':
      return `${ev.bytes} bytes`;
  }
}

export const TIER_LABEL: Readonly<Record<KEvent['tier'], string>> = {
  T: 'Tracepoint',
  P: 'Function probe',
  S: 'Synthetic, no kernel hook',
};
