import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../test/helpers/fixture';
import { Bus } from './bus';
import { FixtureSource } from './fixtureSource';
import { Runtime } from './runtime';

describe('Runtime', () => {
  it('steps one event at a time and emits kevent', () => {
    const bus = new Bus();
    const seen: number[] = [];
    bus.on('kevent', ({ event }) => seen.push(event.seq));
    const rt = new Runtime(new FixtureSource(loadFixture()), bus);
    rt.step();
    rt.step();
    expect(seen).toEqual([0, 1]);
    expect(rt.state.seq).toBe(1);
  });

  it('runs until a time, inclusive', () => {
    const rt = new Runtime(new FixtureSource(loadFixture()));
    const n = rt.runUntil(4000);
    expect(rt.state.now).toBe(4000);
    expect(rt.state.tasks[100]?.state).toBe('sleeping');
    expect(n).toBe(20);
  });

  it('resets to the initial state and replays identically', () => {
    const bus = new Bus();
    let resets = 0;
    let ends = 0;
    bus.on('sim:reset', () => resets++);
    bus.on('sim:end', () => ends++);
    const rt = new Runtime(new FixtureSource(loadFixture()), bus);
    rt.runToEnd();
    const first = JSON.stringify(rt.state);
    rt.reset();
    expect(rt.state.seq).toBe(-1);
    rt.runToEnd();
    expect(JSON.stringify(rt.state)).toBe(first);
    expect(resets).toBe(1);
    expect(ends).toBe(2);
    expect(rt.step()).toBeNull();
  });

  it('refuses an invalid event', () => {
    const file = loadFixture();
    file.events[1] = { ...file.events[1]!, seq: 0 };
    const rt = new Runtime(new FixtureSource(file));
    rt.step();
    expect(() => rt.step()).toThrow(/seq 0 not after 0/);
  });
});
