// ARCHITECTURE.md rule 6: every event type and every named kernel function
// has an evidence entry. Format: evidence/README.md.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FUNCTION_STATIONS } from '../src/core/stations';
import { EVENT_TYPES } from '../src/core/types';
import { loadFixture } from './helpers/fixture';

const EVIDENCE = resolve(__dirname, '../evidence');
const STATUSES = ['verified', 'not-verified', 'drop'];

interface Entry {
  file: string;
  anchor: string;
  status: string;
}
interface Index {
  kernel: string;
  events: Record<string, Entry>;
  functions: Record<string, Entry>;
}

function anchorsOf(md: string): Set<string> {
  const out = new Set<string>();
  for (const m of md.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    out.add(m[1]!.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-'));
  }
  return out;
}

function loadIndex(): Index {
  return JSON.parse(readFileSync(join(EVIDENCE, 'index.json'), 'utf8')) as Index;
}

function problems(kind: string, names: string[], table: Record<string, Entry> | undefined): string[] {
  const out: string[] = [];
  for (const name of names) {
    const e = table?.[name];
    if (!e) {
      out.push(`${kind} ${name}: no entry`);
      continue;
    }
    if (!STATUSES.includes(e.status)) out.push(`${kind} ${name}: bad status ${e.status}`);
    const path = join(EVIDENCE, e.file);
    if (!existsSync(path)) {
      out.push(`${kind} ${name}: file ${e.file} missing`);
      continue;
    }
    if (!anchorsOf(readFileSync(path, 'utf8')).has(e.anchor)) out.push(`${kind} ${name}: no heading #${e.anchor} in ${e.file}`);
  }
  return out;
}

describe('evidence coverage', () => {
  it('evidence/index.json exists and pins v6.18', () => {
    expect(existsSync(join(EVIDENCE, 'index.json'))).toBe(true);
    expect(loadIndex().kernel).toBe('v6.18');
  });

  it('every event type has an entry that resolves to a heading', () => {
    expect(problems('event', EVENT_TYPES, loadIndex().events)).toEqual([]);
  });

  it('every function in stations.ts and in the fixture has an entry', () => {
    const fns = new Set(Object.keys(FUNCTION_STATIONS));
    for (const ev of loadFixture().events) if (ev.type === 'func_entry' || ev.type === 'func_exit') fns.add(ev.fn);
    expect(problems('function', [...fns], loadIndex().functions)).toEqual([]);
  });
});
