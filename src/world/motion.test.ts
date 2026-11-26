import { describe, expect, it } from 'vitest';
import { FixtureSource } from '../core/fixtureSource';
import { Runtime } from '../core/runtime';
import { loadFixture } from '../../test/helpers/fixture';
import { ZONES, stationPath, stationPoint } from './layout';
import { Motion, Mover, ease, pathLength, pointAlong } from './motion';
import { viewOf } from './view';

describe('route interpolation', () => {
  const path = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }];

  it('measures and walks a polyline by arc length', () => {
    expect(pathLength(path)).toBe(20);
    expect(pointAlong(path, 0)).toEqual({ x: 0, z: 0 });
    expect(pointAlong(path, 0.25)).toEqual({ x: 5, z: 0 });
    expect(pointAlong(path, 0.75)).toEqual({ x: 10, z: 5 });
    expect(pointAlong(path, 1)).toEqual({ x: 10, z: 10 });
    expect(pointAlong([{ x: 3, z: 4 }], 0.5)).toEqual({ x: 3, z: 4 });
  });

  it('eases from 0 to 1', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBe(0.5);
  });

  it('finds routes through the station graph', () => {
    expect(stationPath('user', 'vfs')).toEqual(['user', 'syscall_gate', 'vfs']);
    expect(stationPath('device:vda', 'softirq')).toEqual(['device:vda', 'irq', 'softirq']);
    expect(stationPath('page_cache', 'page_cache')).toEqual(['page_cache']);
  });

  it('a mover reaches its target through the via points', () => {
    const m = new Mover({ x: 0, z: 0 });
    m.moveTo({ x: 10, z: 10 }, [{ x: 10, z: 0 }], 100);
    m.advance(50);
    expect(m.pos).toEqual({ x: 10, z: 0 });
    expect(m.moving).toBe(true);
    m.advance(60);
    expect(m.pos).toEqual({ x: 10, z: 10 });
    expect(m.moving).toBe(false);
  });
});

describe('Motion on the fixture', () => {
  const file = loadFixture();

  it('the reader walks from its home through the gate, not around it', () => {
    const rt = new Runtime(new FixtureSource(file));
    const motion = new Motion({ moveMs: 100 });
    motion.reset(viewOf(rt.state));
    const start = { ...motion.taskPos(100)! };
    rt.step(); // sys_enter
    rt.step(); // ksys_read: vfs
    const zs: number[] = [];
    for (let i = 0; i < 20; i++) {
      motion.step(viewOf(rt.state), 10);
      zs.push(motion.taskPos(100)!.z);
    }
    // It moves monotonically south across the gate band.
    expect(zs[0]!).toBeGreaterThan(start.z);
    expect(Math.max(...zs)).toBeGreaterThan(ZONES.gate.maxZ);
    expect(motion.taskPos(100)).toEqual(viewOf(rt.state).tasks.find((t) => t.pid === 100)!.at);
  });

  it('a task without a CPU never moves, and the token leaves it', () => {
    const rt = new Runtime(new FixtureSource(file));
    const motion = new Motion({ moveMs: 100 });
    motion.reset(viewOf(rt.state));
    // Run up to and including the reader's switch-out.
    for (let ev = rt.step(); ev; ev = rt.step()) {
      motion.step(viewOf(rt.state), 1000);
      if (ev.type === 'sched_switch' && ev.prevPid === 100) break;
    }
    const parked = { ...motion.taskPos(100)! };
    const lane = stationPoint('runqueue:0');
    for (let i = 0; i < 20; i++) motion.step(viewOf(rt.state), 50);
    expect(motion.tokens.get(0)!.m.pos).toEqual(lane);
    for (let ev = rt.step(); ev; ev = rt.step()) {
      if (ev.type === 'sched_switch' && ev.nextPid === 100) break;
      for (let i = 0; i < 5; i++) {
        motion.step(viewOf(rt.state), 10);
        expect(motion.taskPos(100)).toEqual(parked);
      }
    }
  });

  it('the borrowed token travels to irq and back to busy-a', () => {
    const rt = new Runtime(new FixtureSource(file));
    const motion = new Motion({ moveMs: 100 });
    motion.reset(viewOf(rt.state));
    for (let ev = rt.step(); ev; ev = rt.step()) {
      if (ev.type === 'irq_handler_entry') break;
      motion.step(viewOf(rt.state), 1000);
    }
    const tok = motion.tokens.get(1)!;
    motion.step(viewOf(rt.state), 50);
    expect(tok.m.moving).toBe(true);
    motion.step(viewOf(rt.state), 60);
    const want = viewOf(rt.state).tokens[1]!.at;
    expect(tok.m.pos).toEqual(want);
    // busy-a stays at home while its CPU is borrowed
    expect(motion.taskPos(101)).toEqual(viewOf(rt.state).tasks.find((t) => t.pid === 101)!.at);
  });

  it('reset puts every entity back at its start', () => {
    const rt = new Runtime(new FixtureSource(file));
    const motion = new Motion();
    motion.reset(viewOf(rt.state));
    const snapshot = () => ({
      tasks: [...motion.tasks].map(([k, v]) => [k, v.m.pos]),
      tokens: [...motion.tokens].map(([k, v]) => [k, v.m.pos]),
      flows: motion.flows.size,
      requests: motion.requests.size,
    });
    const before = snapshot();
    for (let i = 0; i < 20; i++) {
      rt.step();
      motion.step(viewOf(rt.state), 40);
    }
    expect(snapshot()).not.toEqual(before);
    rt.reset();
    motion.reset(viewOf(rt.state));
    expect(snapshot()).toEqual(before);
  });

  it('the per-frame cost stays small', () => {
    const rt = new Runtime(new FixtureSource(file));
    const motion = new Motion();
    motion.reset(viewOf(rt.state));
    const t0 = performance.now();
    let frames = 0;
    while (!rt.done) {
      rt.step();
      for (let i = 0; i < 20; i++, frames++) motion.step(viewOf(rt.state), 16);
    }
    const perFrame = (performance.now() - t0) / frames;
    expect(perFrame).toBeLessThan(1);
  });
});
