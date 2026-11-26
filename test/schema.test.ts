import { describe, expect, it } from 'vitest';
import { EVENT_SPEC, EVENT_TYPES } from '../src/core/types';
import { validateStream } from '../src/core/validate';
import { loadFixture } from './helpers/fixture';

describe('event schema', () => {
  it('the fixture is a valid stream', () => {
    const f = loadFixture();
    expect(validateStream(f.header, f.events)).toEqual([]);
  });

  it('the fixture is marked as hand-written', () => {
    expect(loadFixture().header.note).toMatch(/hand-written/i);
  });

  it('every event in the fixture carries its tier', () => {
    for (const ev of loadFixture().events) expect(ev.tier).toBe(EVENT_SPEC[ev.type].tier);
  });

  it('catches seq and ts going back, bad cpu, unknown pid, unknown type, missing fields', () => {
    const f = loadFixture();
    const e = f.events;
    const broken = [
      e[0],
      { ...e[1], seq: 0 },
      { ...e[2], ts: 0 },
      { ...e[3], cpu: 9 },
      { ...e[4], pid: 999 },
      { ...e[5], type: 'teleport' },
      { seq: 99, ts: 999_999, cpu: 0, pid: 100, tier: 'T', type: 'sched_switch', prevPid: 100 },
    ];
    const msgs = validateStream(f.header, broken).map((i) => i.message);
    expect(msgs).toEqual(
      expect.arrayContaining([
        'seq 0 not after 0',
        expect.stringMatching(/^ts 0 before/),
        'cpu 9 out of range',
        'pid 999 not in snapshot',
        'unknown type teleport',
        'missing field prevState',
        'missing field nextPid',
      ]),
    );
  });

  it('catches payload fields of the wrong type', () => {
    const f = loadFixture();
    const ev = { seq: 0, ts: 1, cpu: 0, pid: 100, tier: 'T', type: 'block_bio_queue', dev: 'vda', sector: 'x', nrSectors: 8 };
    const sw = { seq: 1, ts: 2, cpu: 0, pid: 100, tier: 'T', type: 'sched_switch', prevPid: 100, prevState: 'Z', nextPid: 0 };
    const msgs = validateStream(f.header, [ev, sw]).map((i) => i.message);
    expect(msgs).toEqual(["sector must be an integer", "prevState must be 'R', 'S' or 'D'"]);
  });

  it('lists each Stage 1 type exactly once', () => {
    expect(new Set(EVENT_TYPES).size).toBe(EVENT_TYPES.length);
    expect(EVENT_TYPES.length).toBe(23);
  });
});
