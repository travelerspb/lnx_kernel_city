// What the inspector shows for a selection, as data. Reads KernelState and
// the log; never writes either.

import { info, stationInfo, type InfoEntry } from '../core/glossary';
import type { KernelState, RequestStage, Selection, StationId } from '../core/types';
import { TIER_LABEL, formatNs, taskName } from './format';
import type { LogModel } from './logModel';

export interface InspectorField {
  label: string;
  value: string;
  /** Clicking the value selects this. */
  select?: Selection;
  href?: string;
}

export interface InspectorView {
  title: string;
  subtitle?: string;
  fields: InspectorField[];
  /** Shown when the entity no longer exists or was never seen. */
  note?: string;
  /** What this thing is, from core/glossary.ts. */
  about?: AboutView;
}

export interface AboutView {
  summary: string;
  body: string;
  inScenario?: string;
  stage?: number;
  source: string[];
  evidence: { label: string; href: string }[];
  related: { label: string; select: Selection }[];
}

/** The selection that shows a glossary entry: map things by their own kind. */
export function selectionForInfo(id: string): Selection {
  const [kind, ...rest] = id.split(':');
  const name = rest.join(':');
  if (kind === 'zone') return { kind: 'zone', zone: name };
  if (kind === 'district') return { kind: 'district', district: name };
  if (kind === 'station') return { kind: 'station', station: name as StationId };
  return { kind: 'info', id };
}

function titleOf(id: string): string {
  return (id.startsWith('station:') ? stationInfo(id.slice(8)) : info(id))?.title ?? id;
}

export function aboutView(e: InfoEntry, evidenceBase: string): AboutView {
  const about: AboutView = {
    summary: e.summary,
    body: e.body,
    source: e.source ?? [],
    evidence: (e.evidence ?? []).map((r) => ({ label: `${r.file}#${r.anchor}`, href: `${evidenceBase}${r.file}#${r.anchor}` })),
    related: (e.related ?? []).map((id) => ({ label: titleOf(id), select: selectionForInfo(id) })),
  };
  if (e.inScenario) about.inScenario = e.inScenario;
  if (e.stage) about.stage = e.stage;
  return about;
}

/** Field whose value explains a state, for example "sleeping" with its meaning. */
function meaning(label: string, id: string): InspectorField | null {
  const e = info(id);
  return e ? { label, value: `${e.title}: ${e.summary}`, select: { kind: 'info', id } } : null;
}

const EMPTY: InspectorView = {
  title: 'Nothing selected',
  fields: [],
  note: 'Click anything on the map, or a row in the event log, to see what it is. Hover for a one-line summary.',
};

function task(state: Readonly<KernelState>, pid: number, evidenceBase: string): InspectorView {
  if (pid === 0) {
    return { title: 'idle task (pid 0)', fields: [{ label: 'pid', value: '0' }], note: 'The per-CPU idle task runs when nothing else is runnable.' };
  }
  const t = state.tasks[pid];
  if (!t) return { title: `pid ${pid}`, fields: [], note: 'No such task in the current state.' };
  const fields: InspectorField[] = [
    { label: 'pid', value: String(t.pid) },
    { label: 'comm', value: t.comm },
    { label: 'kind', value: t.kind },
    { label: 'mode', value: t.mode },
    { label: 'state', value: t.state + (t.sleep ? ` (${t.sleep === 'D' ? 'D, uninterruptible' : 'S, interruptible'})` : '') + (t.waking ? ', waking' : '') },
    t.cpu === null ? { label: 'cpu', value: '—' } : { label: 'cpu', value: String(t.cpu), select: { kind: 'station', station: `cpu:${t.cpu}` } },
    { label: 'station', value: t.station, select: { kind: 'station', station: t.station } },
  ];
  for (const f of Object.values(state.flows)) {
    if (f.pid === pid) fields.push({ label: 'flow', value: `#${f.id} ${f.name}`, select: { kind: 'flow', flow: f.id } });
  }
  const m = meaning('state means', `task-state:${t.state}`);
  if (m) fields.push(m);
  const view: InspectorView = { title: `${t.comm} (pid ${t.pid})`, subtitle: 'task', fields };
  // A scenario task with its own entry explains its role; others get the generic kind.
  const about = info(`task:${t.comm}`) ?? info(`task-kind:${t.kind}`);
  if (about) view.about = aboutView(about, evidenceBase);
  return view;
}

function event(state: Readonly<KernelState>, log: LogModel, seq: number): InspectorView {
  const row = log.bySeq(seq);
  if (!row) return { title: `event #${seq}`, fields: [], note: 'This event is no longer in the log.' };
  const fields: InspectorField[] = [
    { label: 'seq', value: String(row.seq) },
    { label: 'ts', value: `${row.tsText} (${row.ts} ns)` },
    { label: 'cpu', value: String(row.cpu), select: { kind: 'station', station: `cpu:${row.cpu}` } },
    { label: 'task', value: row.task, select: { kind: 'task', pid: row.pid } },
    { label: 'tier', value: `${row.tier}: ${TIER_LABEL[row.tier]}`, select: { kind: 'info', id: `tier:${row.tier}` } },
    { label: 'station', value: row.station, select: { kind: 'station', station: row.station } },
  ];
  if (row.flow !== null) fields.push({ label: 'flow', value: `#${row.flow}`, select: { kind: 'flow', flow: row.flow } });
  const envelope = new Set(['seq', 'ts', 'cpu', 'pid', 'tier', 'flow', 'type']);
  for (const [k, v] of Object.entries(row.event)) {
    if (!envelope.has(k)) fields.push({ label: k, value: Array.isArray(v) ? `[${v.join(', ')}]` : String(v) });
  }
  fields.push(
    row.evidence
      ? { label: 'evidence', value: `${row.evidence.label} (${row.evidence.status})`, href: row.evidence.href }
      : { label: 'evidence', value: 'no evidence entry' },
  );
  if (row.seq > state.seq) fields.push({ label: 'note', value: 'not yet applied' });
  return { title: `${row.type} #${row.seq}`, subtitle: row.text, fields };
}

function flow(state: Readonly<KernelState>, log: LogModel, id: number): InspectorView {
  const rows = log.ofFlow(id);
  const f = state.flows[id];
  const first = rows[0];
  const last = rows[rows.length - 1];
  const fields: InspectorField[] = [{ label: 'flow', value: `#${id}` }];
  if (f) {
    fields.push(
      { label: 'kind', value: f.kind },
      { label: 'name', value: f.name },
      { label: 'task', value: taskName(state, f.pid), select: { kind: 'task', pid: f.pid } },
      { label: 'station', value: f.station, select: { kind: 'station', station: f.station } },
      { label: 'started', value: formatNs(f.startedAt) },
      { label: 'running for', value: formatNs(state.now - f.startedAt) },
    );
  } else if (first && last) {
    fields.push(
      { label: 'task', value: first.task, select: { kind: 'task', pid: first.pid } },
      { label: 'started', value: first.tsText },
      { label: 'ended', value: last.tsText },
      { label: 'duration', value: formatNs(last.ts - first.ts) },
    );
  }
  fields.push({ label: 'events in log', value: String(rows.length) });
  if (first) fields.push({ label: 'first event', value: `${first.type} #${first.seq}`, select: { kind: 'event', seq: first.seq } });
  if (last && last !== first) fields.push({ label: 'last event', value: `${last.type} #${last.seq}`, select: { kind: 'event', seq: last.seq } });
  const view: InspectorView = { title: f ? `${f.name}() flow #${id}` : `flow #${id}`, subtitle: 'request', fields };
  if (!f) view.note = rows.length > 0 ? 'This request has finished.' : 'This flow is not in the current state or the log.';
  return view;
}

/** Whether a request at this stage is at the block, driver or device station. */
function requestIsAt(stage: RequestStage, id: StationId): boolean {
  if (id === 'block') return stage === 'queued' || stage === 'inserted';
  if (id.startsWith('driver:')) return stage === 'issued';
  return stage === 'in_device' || stage === 'device_done';
}

function station(state: Readonly<KernelState>, id: StationId, evidenceBase: string): InspectorView {
  const fields: InspectorField[] = [];
  const cpuMatch = /^(cpu|runqueue):(\d+)$/.exec(id);
  if (cpuMatch) {
    const c = state.cpus[Number(cpuMatch[2])];
    if (c) {
      fields.push(
        { label: 'current', value: taskName(state, c.current, c.id), select: { kind: 'task', pid: c.current } },
        { label: 'context', value: c.context + (c.interrupted.length ? ` (interrupted: ${c.interrupted.join(' > ')})` : ''), select: { kind: 'info', id: `cpu-context:${c.context}` } },
      );
      if (c.runqueue.length === 0) fields.push({ label: 'runqueue', value: 'empty' });
      for (const p of c.runqueue) fields.push({ label: 'queued', value: taskName(state, p), select: { kind: 'task', pid: p } });
    }
  }
  if (id === 'page_cache') {
    const pages = Object.entries(state.pageCache);
    if (pages.length === 0) fields.push({ label: 'pages', value: 'none cached' });
    for (const [k, s] of pages) fields.push({ label: `page ${k}`, value: s, select: { kind: 'info', id: `page-state:${s}` } });
  }
  if (id === 'block' || id.startsWith('driver:') || id.startsWith('device:')) {
    for (const [dev, all] of Object.entries(state.blockQueues)) {
      if (id.startsWith('device:') && id !== `device:${dev}`) continue;
      const q = all.filter((r) => requestIsAt(r.stage, id));
      if (q.length === 0) fields.push({ label: dev, value: 'no requests here' });
      for (const r of q) {
        fields.push({
          label: `${dev} sector ${r.sector}`,
          value: `+${r.nrSectors}, ${r.stage}${r.flow === null ? '' : `, flow #${r.flow}`}`,
          ...(r.flow === null ? {} : { select: { kind: 'flow', flow: r.flow } as Selection }),
        });
      }
    }
  }
  for (const t of Object.values(state.tasks)) {
    if (t.station === id) fields.push({ label: 'task here', value: taskName(state, t.pid), select: { kind: 'task', pid: t.pid } });
  }
  for (const f of Object.values(state.flows)) {
    if (f.station === id) fields.push({ label: 'request here', value: `#${f.id} ${f.name}`, select: { kind: 'flow', flow: f.id } });
  }
  const e = stationInfo(id);
  const view: InspectorView = { title: e?.title ?? id, subtitle: `station ${id}`, fields };
  if (e) view.about = aboutView(e, evidenceBase);
  if (fields.length === 0) view.note = 'Nothing is here right now.';
  return view;
}

function area(state: Readonly<KernelState>, id: string, kind: 'zone' | 'district', evidenceBase: string): InspectorView {
  const e = info(`${kind}:${id}`);
  const fields: InspectorField[] = [];
  if (id === 'userland') {
    for (const t of Object.values(state.tasks)) {
      if (t.kind === 'user') fields.push({ label: t.mode === 'user' ? 'at home' : 'in the kernel', value: taskName(state, t.pid), select: { kind: 'task', pid: t.pid } });
    }
  }
  if (id === 'scheduler' || id === 'hardware') {
    for (const c of state.cpus) fields.push({ label: `cpu ${c.id}`, value: `${taskName(state, c.current, c.id)}, ${c.context}`, select: { kind: 'station', station: `cpu:${c.id}` } });
  }
  const view: InspectorView = { title: e?.title ?? id, subtitle: kind === 'zone' ? 'zone' : e?.stage ? `district, stage ${e.stage}` : 'district', fields };
  if (e) view.about = aboutView(e, evidenceBase);
  else view.note = 'No description yet.';
  return view;
}

function concept(id: string, evidenceBase: string): InspectorView {
  const e = info(id);
  if (!e) return { title: id, fields: [], note: 'No description yet.' };
  return { title: e.title, subtitle: e.kind.replace('-', ' '), fields: [], about: aboutView(e, evidenceBase) };
}

export function inspectorView(sel: Selection | null, state: Readonly<KernelState> | null, log: LogModel): InspectorView {
  if (!sel) return EMPTY;
  if (!state) return { title: 'No state yet', fields: [] };
  switch (sel.kind) {
    case 'task':
      return task(state, sel.pid, log.evidenceBase);
    case 'event':
      return event(state, log, sel.seq);
    case 'flow':
      return flow(state, log, sel.flow);
    case 'station':
      return station(state, sel.station, log.evidenceBase);
    case 'zone':
      return area(state, sel.zone, 'zone', log.evidenceBase);
    case 'district':
      return area(state, sel.district, 'district', log.evidenceBase);
    case 'info':
      return concept(sel.id, log.evidenceBase);
  }
}
