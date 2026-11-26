// Evidence links for the event log. The index format is fixed in
// evidence/README.md. The index may be missing (WP1 not landed, fetch failed);
// every caller must handle a null result and show a "no evidence" marker.

import type { KEvent } from '../core/types';

export type EvidenceStatus = 'verified' | 'not-verified' | 'drop';

export interface EvidenceEntry {
  file: string;
  anchor: string;
  status: EvidenceStatus;
}

export interface EvidenceIndex {
  kernel: string;
  events: Record<string, EvidenceEntry>;
  functions: Record<string, EvidenceEntry>;
}

export interface EvidenceLink {
  href: string;
  /** "read-path.md#vfs-read", for the link text and title. */
  label: string;
  status: EvidenceStatus;
  /** Which table matched: the function name or the event type. */
  via: 'function' | 'event';
}

const STATUSES: ReadonlySet<string> = new Set(['verified', 'not-verified', 'drop']);

function isEntry(v: unknown): v is EvidenceEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e['file'] === 'string' && typeof e['anchor'] === 'string' && typeof e['status'] === 'string' && STATUSES.has(e['status']);
}

function entries(v: unknown): Record<string, EvidenceEntry> {
  const out: Record<string, EvidenceEntry> = {};
  if (typeof v !== 'object' || v === null) return out;
  for (const [k, e] of Object.entries(v)) if (isEntry(e)) out[k] = e;
  return out;
}

/** Accept parsed JSON of unknown shape; keep only well-formed entries. */
export function parseEvidenceIndex(json: unknown): EvidenceIndex | null {
  if (typeof json !== 'object' || json === null) return null;
  const o = json as Record<string, unknown>;
  return {
    kernel: typeof o['kernel'] === 'string' ? o['kernel'] : '?',
    events: entries(o['events']),
    functions: entries(o['functions']),
  };
}

/** Fetch and parse the index. Resolves to null on any failure, never rejects. */
export async function loadEvidenceIndex(
  url: string,
  fetchFn: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }> = (u) => fetch(u),
): Promise<EvidenceIndex | null> {
  try {
    const res = await fetchFn(url);
    if (!res.ok) return null;
    return parseEvidenceIndex(await res.json());
  } catch {
    return null;
  }
}

function own(table: Record<string, EvidenceEntry>, key: string): EvidenceEntry | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

function join(base: string, file: string): string {
  if (base === '') return file;
  return base.endsWith('/') ? base + file : `${base}/${file}`;
}

/**
 * The evidence entry for one event. A `func_entry` / `func_exit` links to its
 * function's entry when there is one, else to the event type's entry.
 * `base` is prefixed to the file, for example "evidence/" or a repository
 * blob URL.
 */
export function resolveEvidence(index: EvidenceIndex | null, ev: KEvent, base: string): EvidenceLink | null {
  if (!index) return null;
  let entry: EvidenceEntry | undefined;
  let via: EvidenceLink['via'] = 'event';
  if (ev.type === 'func_entry' || ev.type === 'func_exit') {
    entry = own(index.functions, ev.fn);
    if (entry) via = 'function';
  }
  entry ??= own(index.events, ev.type);
  if (!entry) return null;
  const label = entry.anchor ? `${entry.file}#${entry.anchor}` : entry.file;
  return { href: join(base, label), label, status: entry.status, via };
}
