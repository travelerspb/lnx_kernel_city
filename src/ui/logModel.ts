// The event log as data: one row per applied event, capped in length, with a
// flow filter. The DOM view in log.ts renders these rows; tests use this
// module directly.

import { stationOfEvent } from '../core/stations';
import type { KEvent, KernelState, StationId, Tier } from '../core/types';
import { resolveEvidence, type EvidenceIndex, type EvidenceLink } from './evidence';
import { describeEvent, formatNs, taskName } from './format';

export interface LogRow {
  seq: number;
  ts: number;
  tsText: string;
  cpu: number;
  pid: number;
  /** "reader(100)" */
  task: string;
  type: KEvent['type'];
  tier: Tier;
  flow: number | null;
  text: string;
  station: StationId;
  evidence: EvidenceLink | null;
  event: KEvent;
}

export function buildRow(
  ev: KEvent,
  state: Readonly<KernelState> | null,
  index: EvidenceIndex | null,
  evidenceBase: string,
): LogRow {
  return {
    seq: ev.seq,
    ts: ev.ts,
    tsText: formatNs(ev.ts),
    cpu: ev.cpu,
    pid: ev.pid,
    task: taskName(state, ev.pid, ev.cpu),
    type: ev.type,
    tier: ev.tier,
    flow: ev.flow ?? null,
    text: describeEvent(ev, state),
    station: stationOfEvent(ev),
    evidence: resolveEvidence(index, ev, evidenceBase),
    event: ev,
  };
}

/** `'all'` shows every row, `'none'` rows without a flow, a number one flow. */
export type FlowFilter = 'all' | 'none' | number;

export function matchesFlow(row: LogRow, filter: FlowFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'none') return row.flow === null;
  return row.flow === filter;
}

export const DEFAULT_LOG_CAP = 2000;

export class LogModel {
  private _rows: LogRow[] = [];
  private _flows = new Set<number>();
  private index: EvidenceIndex | null;
  /** Rows dropped from the front because of the cap, since the last clear. */
  dropped = 0;
  filter: FlowFilter = 'all';
  /** Bumped on every change, so a view can tell whether to redraw. */
  version = 0;
  /** Bumped on every clear, so a view can tell appends from a restart. */
  generation = 0;

  constructor(
    index: EvidenceIndex | null = null,
    readonly evidenceBase = 'evidence/',
    readonly cap = DEFAULT_LOG_CAP,
  ) {
    this.index = index;
  }

  get rows(): readonly LogRow[] {
    return this._rows;
  }

  /** Flow ids seen since the last clear, ascending. */
  get flows(): number[] {
    return [...this._flows].sort((a, b) => a - b);
  }

  /** The last applied event, the one the view highlights. */
  get current(): LogRow | undefined {
    return this._rows[this._rows.length - 1];
  }

  get evidenceIndex(): EvidenceIndex | null {
    return this.index;
  }

  push(ev: KEvent, state: Readonly<KernelState> | null): LogRow {
    const row = buildRow(ev, state, this.index, this.evidenceBase);
    this._rows.push(row);
    if (row.flow !== null) this._flows.add(row.flow);
    if (this._rows.length > this.cap) {
      const n = this._rows.length - this.cap;
      this._rows.splice(0, n);
      this.dropped += n;
    }
    this.version++;
    return row;
  }

  clear(): void {
    this._rows = [];
    this._flows.clear();
    this.dropped = 0;
    this.generation++;
    this.version++;
  }

  /** Swap the evidence index (it may arrive after the first events). */
  setEvidenceIndex(index: EvidenceIndex | null): void {
    this.index = index;
    for (const r of this._rows) r.evidence = resolveEvidence(index, r.event, this.evidenceBase);
    this.version++;
  }

  setFilter(filter: FlowFilter): void {
    this.filter = filter;
    this.version++;
  }

  visible(): LogRow[] {
    return this._rows.filter((r) => matchesFlow(r, this.filter));
  }

  bySeq(seq: number): LogRow | undefined {
    // Rows are in seq order; binary search.
    let lo = 0;
    let hi = this._rows.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = this._rows[mid]!;
      if (r.seq === seq) return r;
      if (r.seq < seq) lo = mid + 1;
      else hi = mid - 1;
    }
    return undefined;
  }

  /** Rows of one flow, in order. */
  ofFlow(flow: number): LogRow[] {
    return this._rows.filter((r) => r.flow === flow);
  }
}
