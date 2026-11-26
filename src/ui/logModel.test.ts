import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../test/helpers/fixture';
import { Bus } from '../core/bus';
import { FixtureSource } from '../core/fixtureSource';
import { Runtime } from '../core/runtime';
import { EVENT_TYPES } from '../core/types';
import type { EvidenceIndex } from './evidence';
import { LogModel } from './logModel';

function setup(index: EvidenceIndex | null = null, cap?: number) {
  const bus = new Bus();
  const log = new LogModel(index, 'evidence/', cap);
  bus.on('kevent', ({ event, state }) => log.push(event, state));
  bus.on('sim:reset', () => log.clear());
  const rt = new Runtime(new FixtureSource(loadFixture()), bus);
  return { bus, log, rt };
}

const fullIndex: EvidenceIndex = {
  kernel: 'v6.18',
  events: Object.fromEntries(EVENT_TYPES.map((t) => [t, { file: 'read-path.md', anchor: t.replaceAll('_', '-'), status: 'verified' as const }])),
  functions: {},
};

describe('LogModel with the fixture', () => {
  it('step adds exactly one row, the current one', () => {
    const { log, rt } = setup();
    rt.step();
    expect(log.rows).toHaveLength(1);
    rt.step();
    expect(log.rows).toHaveLength(2);
    expect(log.current?.seq).toBe(1);
    expect(log.current?.seq).toBe(rt.state.seq);
  });

  it('reset empties the log', () => {
    const { log, rt } = setup();
    rt.runToEnd();
    expect(log.rows.length).toBe(loadFixture().events.length);
    rt.reset();
    expect(log.rows).toHaveLength(0);
    expect(log.flows).toEqual([]);
    expect(log.current).toBeUndefined();
  });

  it('every row has a tier and either an evidence link or none (marker)', () => {
    const { log, rt } = setup();
    rt.runToEnd();
    for (const r of log.rows) {
      expect(['T', 'P', 'S']).toContain(r.tier);
      expect(r.evidence).toBeNull();
    }
    log.setEvidenceIndex(fullIndex);
    for (const r of log.rows) expect(r.evidence?.href).toMatch(/^evidence\/read-path\.md#[a-z-]+$/);
  });

  it('builds row text, task names and stations', () => {
    const { log, rt } = setup();
    rt.step();
    const r = log.rows[0]!;
    expect(r).toMatchObject({ seq: 0, ts: 1000, tsText: '1.000 µs', cpu: 0, task: 'reader(100)', type: 'sys_enter', tier: 'T', flow: 1, text: 'read(3, 4096, 4096)', station: 'syscall_gate' });
  });

  it('filters by flow', () => {
    const { log, rt } = setup();
    rt.runToEnd();
    expect(log.flows).toEqual([1, 2]);
    log.setFilter(2);
    expect(log.visible().every((r) => r.flow === 2)).toBe(true);
    expect(log.visible().length).toBe(log.ofFlow(2).length);
    log.setFilter('none');
    expect(log.visible().every((r) => r.flow === null)).toBe(true);
    log.setFilter('all');
    expect(log.visible().length).toBe(log.rows.length);
  });

  it('caps its length and still finds rows by seq', () => {
    const { log, rt } = setup(null, 10);
    rt.runToEnd();
    const n = loadFixture().events.length;
    expect(log.rows).toHaveLength(10);
    expect(log.dropped).toBe(n - 10);
    expect(log.rows[0]?.seq).toBe(n - 10);
    expect(log.bySeq(n - 1)?.seq).toBe(n - 1);
    expect(log.bySeq(0)).toBeUndefined();
  });
});
