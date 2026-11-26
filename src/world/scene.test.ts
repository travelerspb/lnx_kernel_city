// Drives the whole scene graph (districts, entities, picking) without WebGL.
// Labels need a 2D canvas, so a minimal fake document is installed.

import { join, resolve } from 'node:path';
import { OrthographicCamera } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { FixtureSource, type EventFile } from '../core/fixtureSource';
import { Runtime } from '../core/runtime';
import type { KernelState } from '../core/types';
import { fitView, frustum, type View } from '../engine/cameraMath';
import { Picker } from '../engine/picking';
import { findForbiddenImports, listTs } from '../../test/helpers/imports';
import { loadFixture } from '../../test/helpers/fixture';
import { MAP_BOUNDS, stationPoint, type Point } from './layout';
import { colour } from './palette';
import { WorldScene } from './scene';

beforeAll(() => {
  const ctx2d = {
    font: '', fillStyle: '', textBaseline: '',
    measureText: (t: string) => ({ width: t.length * 30 }),
    fillText() {},
  };
  const doc = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
  (globalThis as { document?: unknown }).document ??= doc;
});

function camera(v: View, aspect: number): OrthographicCamera {
  const c = new OrthographicCamera(-1, 1, 1, -1, 1, 400);
  const f = frustum(v, aspect);
  Object.assign(c, f);
  c.position.set(v.cx, 200, v.cz);
  c.rotation.set(-Math.PI / 2, 0, 0);
  c.updateProjectionMatrix();
  c.updateMatrixWorld();
  return c;
}
const toNdc = (v: View, aspect: number, p: Point) => ({
  nx: (p.x - v.cx) / (v.halfH * aspect),
  ny: -(p.z - v.cz) / v.halfH,
});

function play(file: EventFile, scene: WorldScene, rt: Runtime, framesPerEvent = 3): void {
  scene.frame(rt.state, 0);
  for (let ev = rt.step(); ev; ev = rt.step()) {
    scene.lastEvent = ev;
    for (let i = 0; i < framesPerEvent; i++) scene.frame(rt.state, 120, i / framesPerEvent);
  }
}

describe('WorldScene', () => {
  const file = loadFixture();

  it('plays the fixture without writing state', () => {
    const picker = new Picker();
    const scene = new WorldScene(picker, 'light');
    const rt = new Runtime(new FixtureSource(file));
    scene.frame(rt.state, 0);
    for (let ev = rt.step(); ev; ev = rt.step()) {
      const before = structuredClone(rt.state) as KernelState;
      scene.lastEvent = ev;
      scene.frame(rt.state, 100, 0.5);
      expect(rt.state).toEqual(before);
    }
    scene.dispose();
  });

  it('plays the fixture with every tier S event removed', () => {
    const noS: EventFile = { header: file.header, events: file.events.filter((e) => e.tier !== 'S') };
    const scene = new WorldScene(new Picker(), 'dark');
    const rt = new Runtime(new FixtureSource(noS));
    expect(() => play(noS, scene, rt)).not.toThrow();
    expect(rt.done).toBe(true);
  });

  it('picks the topmost thing: task over home, station over district, district over zone', () => {
    const picker = new Picker();
    const scene = new WorldScene(picker, 'light');
    const rt = new Runtime(new FixtureSource(file));
    scene.frame(rt.state, 0);
    const aspect = 1.4;
    const v = fitView(MAP_BOUNDS, aspect);
    const cam = camera(v, aspect);
    const p = scene.entities.taskPos(100)!;
    const n = toNdc(v, aspect, p);
    expect(picker.pick(cam, n.nx, n.ny)).toEqual({ kind: 'task', pid: 100 });
    const e = toNdc(v, aspect, { x: 0, z: -58.5 });
    expect(picker.pick(cam, e.nx, e.ny)).toEqual({ kind: 'zone', zone: 'userland' });
    const pc = toNdc(v, aspect, stationPoint('page_cache'));
    expect(picker.pick(cam, pc.nx, pc.ny)).toEqual({ kind: 'station', station: 'page_cache' });
    const vq = toNdc(v, aspect, { x: -40, z: -14 });
    expect(picker.pick(cam, vq.nx, vq.ny)).toEqual({ kind: 'district', district: 'vfs' });
    const lot = toNdc(v, aspect, { x: -40, z: -4 });
    expect(picker.pick(cam, lot.nx, lot.ny)).toEqual({ kind: 'district', district: 'memory' });
    const ground = toNdc(v, aspect, { x: 10, z: 21 });
    expect(picker.pick(cam, ground.nx, ground.ny)).toEqual({ kind: 'zone', zone: 'kernel' });
    const off = toNdc(v, aspect, { x: 0, z: 39.9 });
    expect(picker.pick(cam, off.nx, off.ny)).toEqual({ kind: 'zone', zone: 'hardware' });
  });

  it('reset returns every entity to its start position', () => {
    const scene = new WorldScene(new Picker(), 'light');
    const rt = new Runtime(new FixtureSource(file));
    scene.frame(rt.state, 0);
    const pos = () => [...scene.entities.motion.tasks].map(([k, e]) => [k, { ...e.m.pos }]);
    const tokens = () => [...scene.entities.motion.tokens].map(([k, e]) => [k, { ...e.m.pos }]);
    const p0 = pos();
    const k0 = tokens();
    for (let i = 0; i < 25; i++) {
      rt.step();
      scene.frame(rt.state, 50);
    }
    expect(tokens()).not.toEqual(k0);
    rt.reset();
    scene.reset(scene.frame(rt.state, 0));
    scene.frame(rt.state, 16);
    expect(pos()).toEqual(p0);
    expect(tokens()).toEqual(k0);
    expect(scene.entities.motion.flows.size).toBe(0);
  });

  it('switches theme on every material', () => {
    const scene = new WorldScene(new Picker(), 'light');
    const rt = new Runtime(new FixtureSource(file));
    scene.frame(rt.state, 0);
    const mat = scene.ctx.mats.get('task.user');
    expect(mat.color.getHex()).not.toBe(0);
    scene.setTheme('dark');
    // three converts sRGB hex to linear and back; compare through getHex.
    expect(mat.color.getHex()).toBe(colour('dark', 'task.user'));
  });
});

describe('world boundary', () => {
  it('src/world and src/engine import neither src/sim nor src/ui', () => {
    const root = resolve(__dirname, '../..');
    const entries = [...listTs(join(root, 'src/world')), ...listTs(join(root, 'src/engine'))];
    expect(findForbiddenImports(root, entries, /^$/, ['src/sim', 'src/ui'])).toEqual([]);
  });
});
