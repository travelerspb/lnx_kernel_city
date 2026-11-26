// Structural check of an event stream. It does not need kernel state;
// apply() catches events that do not fit the state.

import { EVENT_SPEC, type KEvent, type StreamHeader } from './types';

export interface ValidationIssue {
  seq: number | null;
  message: string;
}

export interface StreamValidator {
  /** Check one event. Returns the issues it found, empty if none. */
  check(ev: unknown): ValidationIssue[];
}

const int = { what: 'an integer', ok: (v: unknown) => Number.isInteger(v) };
const str = { what: 'a string', ok: (v: unknown) => typeof v === 'string' };
const bool = { what: 'a boolean', ok: (v: unknown) => typeof v === 'boolean' };

/** Expected type of each payload field, by name. Names mean the same thing
 *  in every event type that has them. */
const FIELD_TYPES: Readonly<Record<string, { what: string; ok: (v: unknown) => boolean }>> = {
  name: str,
  fn: str,
  dev: str,
  args: { what: 'an array of integers', ok: (v) => Array.isArray(v) && v.every((x) => Number.isInteger(x)) },
  ret: int,
  ino: int,
  index: int,
  order: int,
  sector: int,
  nrSectors: int,
  error: int,
  irq: int,
  vec: int,
  wakee: int,
  targetCpu: int,
  prevPid: int,
  nextPid: int,
  bytes: int,
  hit: bool,
  ok: bool,
  prevState: { what: "'R', 'S' or 'D'", ok: (v) => v === 'R' || v === 'S' || v === 'D' },
};

export function validateHeader(h: unknown): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const bad = (message: string) => out.push({ seq: null, message });
  if (typeof h !== 'object' || h === null) return [{ seq: null, message: 'header is not an object' }];
  const x = h as Partial<StreamHeader>;
  if (x.schema !== 'lkc-events/0') bad(`unknown schema ${String(x.schema)}`);
  if (typeof x.kernel !== 'string') bad('kernel missing');
  if (x.arch !== 'x86_64' && x.arch !== 'aarch64' && x.arch !== 'riscv64') bad(`unknown arch ${String(x.arch)}`);
  if (!Number.isInteger(x.ncpu) || (x.ncpu ?? 0) < 1) bad('ncpu must be a positive integer');
  if (x.source !== 'sim' && x.source !== 'trace') bad(`unknown source ${String(x.source)}`);
  const s = x.snapshot;
  if (!s || !Array.isArray(s.tasks) || !Array.isArray(s.cpus) || !Array.isArray(s.files)
    || !Array.isArray(s.devices) || !Array.isArray(s.pageCache)) {
    bad('snapshot needs cpus, tasks, files, devices, pageCache arrays');
  } else {
    const pids = new Set<number>();
    for (const t of s.tasks) {
      if (t.pid === 0) bad('pid 0 is the idle task and must not be listed');
      if (pids.has(t.pid)) bad(`pid ${t.pid} listed twice`);
      pids.add(t.pid);
    }
    for (const c of s.cpus) {
      if (c.id < 0 || c.id >= (x.ncpu ?? 0)) bad(`snapshot cpu ${c.id} out of range`);
      if (c.current !== 0 && !pids.has(c.current)) bad(`cpu ${c.id} current pid ${c.current} unknown`);
    }
  }
  return out;
}

export function createValidator(header: StreamHeader): StreamValidator {
  const pids = new Set<number>([0, ...header.snapshot.tasks.map((t) => t.pid)]);
  let lastSeq = -Infinity;
  let lastTs = -Infinity;
  return {
    check(raw) {
      const out: ValidationIssue[] = [];
      if (typeof raw !== 'object' || raw === null) return [{ seq: null, message: 'event is not an object' }];
      const ev = raw as Record<string, unknown> & Partial<KEvent>;
      const seq = typeof ev.seq === 'number' ? ev.seq : null;
      const bad = (message: string) => out.push({ seq, message });
      if (!Number.isInteger(ev.seq)) bad('seq must be an integer');
      else if ((ev.seq as number) <= lastSeq) bad(`seq ${ev.seq} not after ${lastSeq}`);
      if (typeof ev.ts !== 'number' || !Number.isFinite(ev.ts) || ev.ts < 0) bad('ts must be a non-negative number');
      else if (ev.ts < lastTs) bad(`ts ${ev.ts} before ${lastTs}`);
      if (!Number.isInteger(ev.cpu) || (ev.cpu as number) < 0 || (ev.cpu as number) >= header.ncpu) {
        bad(`cpu ${String(ev.cpu)} out of range`);
      }
      if (!Number.isInteger(ev.pid)) bad('pid must be an integer');
      else if (!pids.has(ev.pid as number)) bad(`pid ${ev.pid} not in snapshot`);
      const spec = typeof ev.type === 'string' ? EVENT_SPEC[ev.type as keyof typeof EVENT_SPEC] : undefined;
      if (!spec) bad(`unknown type ${String(ev.type)}`);
      else {
        if (ev.tier !== spec.tier) bad(`tier ${String(ev.tier)} should be ${spec.tier}`);
        for (const f of spec.fields) if (!(f in ev)) bad(`missing field ${f}`);
      }
      for (const [k, v] of Object.entries(ev)) {
        const want = FIELD_TYPES[k];
        if (want && !want.ok(v)) bad(`${k} must be ${want.what}`);
      }
      if (ev.flow !== undefined && !Number.isInteger(ev.flow)) bad('flow must be an integer');
      for (const k of ['wakee', 'prevPid', 'nextPid'] as const) {
        const v = ev[k as keyof typeof ev];
        if (typeof v === 'number' && !pids.has(v)) bad(`${k} ${v} not in snapshot`);
      }
      if (typeof ev.seq === 'number') lastSeq = ev.seq;
      if (typeof ev.ts === 'number') lastTs = Math.max(lastTs, ev.ts);
      return out;
    },
  };
}

/** Validate a whole stream. Returns all issues; empty means valid. */
export function validateStream(header: unknown, events: unknown): ValidationIssue[] {
  const out = validateHeader(header);
  if (out.length > 0) return out;
  if (!Array.isArray(events)) return [{ seq: null, message: 'events is not an array' }];
  const v = createValidator(header as StreamHeader);
  for (const ev of events) out.push(...v.check(ev));
  return out;
}
