// Every zone, district and station on the map has a glossary entry, and every
// evidence link in the glossary points at a real heading.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GLOSSARY, info, stationInfo } from '../src/core/glossary';
import { allStations } from '../src/core/stations';
import { DISTRICTS, ZONES } from '../src/world/layout';

const EVIDENCE = resolve(__dirname, '../evidence');

function anchors(file: string): Set<string> {
  const md = readFileSync(join(EVIDENCE, file), 'utf8');
  const out = new Set<string>();
  for (const m of md.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    out.add(m[1]!.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-'));
  }
  return out;
}

describe('glossary', () => {
  it('has an entry for every zone and district in the layout', () => {
    const missing = [
      ...Object.keys(ZONES).map((z) => `zone:${z}`),
      ...Object.keys(DISTRICTS).map((d) => `district:${d}`),
    ].filter((id) => !info(id));
    expect(missing).toEqual([]);
  });

  it('has an entry for every station, per-CPU ones titled with their CPU', () => {
    expect(allStations(4).filter((s) => !stationInfo(s))).toEqual([]);
    expect(stationInfo('cpu:2')?.title).toBe('CPU core 2');
    expect(stationInfo('runqueue:0')?.id).toBe('station:runqueue:0');
  });

  it('has an entry for every task state, CPU context, page state and tier', () => {
    const ids = [
      'task-state:running', 'task-state:runnable', 'task-state:sleeping',
      'cpu-context:user', 'cpu-context:kernel', 'cpu-context:hardirq', 'cpu-context:softirq', 'cpu-context:idle',
      'page-state:absent', 'page-state:locked', 'page-state:uptodate',
      'tier:T', 'tier:P', 'tier:S',
    ];
    expect(ids.filter((id) => !info(id))).toEqual([]);
  });

  it('keys match ids, summaries are one line, related ids exist', () => {
    for (const [key, e] of Object.entries(GLOSSARY)) {
      expect(e.id, key).toBe(key);
      expect(e.summary, key).not.toMatch(/\n/);
      expect(e.summary.length, key).toBeLessThanOrEqual(140);
      for (const r of e.related ?? []) expect(GLOSSARY[r] ?? stationInfo(r.replace(/^station:/, '')), `${key} -> ${r}`).toBeDefined();
    }
  });

  it('every evidence link resolves to a heading', () => {
    const bad: string[] = [];
    for (const e of Object.values(GLOSSARY)) {
      for (const ref of e.evidence ?? []) {
        if (!existsSync(join(EVIDENCE, ref.file)) || !anchors(ref.file).has(ref.anchor)) bad.push(`${e.id}: ${ref.file}#${ref.anchor}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('later-stage districts say which stage builds them', () => {
    for (const [id, d] of Object.entries(DISTRICTS)) {
      if (d.stage > 1) expect(info(`district:${id}`)?.stage, id).toBe(d.stage);
    }
  });
});
