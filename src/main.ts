// Boot order: bus, event source, runtime, presentation clock, world, UI.
// Frame loop: advance the presentation clock, run the runtime up to its
// target, update the world, update the UI.
//
// URL parameters:
//   ?source=fixture  play the hand-written-shape fixture through FixtureSource,
//                    the same path a recorded trace takes in Stage 6
//   ?seed=<n>        seed for the synthetic model
//   ?noS             drop tier S events, as a real trace would

import fixture from '../test/fixtures/cold-warm-read.events.json';
import evidenceIndex from '../evidence/index.json';
import { Bus } from './core/bus';
import { FixtureSource, type EventFile } from './core/fixtureSource';
import { DEFAULT_SEED } from './core/rng';
import { Runtime } from './core/runtime';
import { PresentationClock } from './core/timebase';
import type { EventSource } from './core/types';
import { createSim } from './sim/model';
import { createUi, type EvidenceIndex } from './ui';
import { createWorld } from './world';

/** Evidence files are Markdown; GitHub renders them and keeps heading anchors. */
const EVIDENCE_BASE = 'https://github.com/travelerspb/lnx_kernel_city/blob/master/evidence/';

function chooseSource(params: URLSearchParams): EventSource {
  const dropS = params.has('noS');
  if (params.get('source') === 'fixture') {
    const file = fixture as unknown as EventFile;
    const events = dropS ? file.events.filter((e) => e.tier !== 'S') : file.events;
    return new FixtureSource({ header: file.header, events });
  }
  const seedParam = Number(params.get('seed'));
  const seed = Number.isInteger(seedParam) && params.has('seed') ? seedParam : DEFAULT_SEED;
  const sim = createSim({ seed });
  if (!dropS) return sim;
  // Record once, then replay without S events through the trace path.
  const rt = new Runtime(sim);
  const events = [];
  for (let ev = rt.step(); ev; ev = rt.step()) if (ev.tier !== 'S') events.push(ev);
  sim.reset();
  return new FixtureSource({ header: sim.header, events });
}

function boot(): void {
  const canvas = document.getElementById('city') as HTMLCanvasElement | null;
  const uiRoot = document.getElementById('ui');
  if (!canvas || !uiRoot) throw new Error('page is missing #city or #ui');

  const params = new URLSearchParams(location.search);
  const bus = new Bus();
  const runtime = new Runtime(chooseSource(params), bus);
  const clock = new PresentationClock();
  const world = createWorld(canvas, bus, () => runtime.state);
  const ui = createUi(uiRoot, bus, {
    getState: () => runtime.state,
    getClock: () => clock,
    evidenceIndex: evidenceIndex as unknown as EvidenceIndex,
    evidenceBase: EVIDENCE_BASE,
  });

  bus.on('transport', (cmd) => {
    switch (cmd.action) {
      case 'play':
        if (clock.mode === 'step') break;
        if (runtime.done) {
          runtime.reset();
          clock.reset();
        }
        clock.play();
        break;
      case 'pause':
        clock.pause();
        break;
      case 'step':
        clock.pause();
        clock.requestStep();
        break;
      case 'reset':
        clock.pause();
        clock.reset();
        runtime.reset();
        break;
      case 'mode':
        clock.setMode(cmd.mode);
        break;
      case 'speed':
        clock.setSpeed(cmd.value);
        break;
    }
  });

  // Fit the map into the band between the top bar and the bottom-left panels.
  const insets = () => {
    const bar = document.querySelector('.lkc-bar')?.getBoundingClientRect();
    const low = ['.lkc-inspector', '.lkc-legend']
      .map((s) => document.querySelector(s)?.getBoundingClientRect().top ?? innerHeight)
      .reduce((a, b) => Math.min(a, b), innerHeight);
    const gap = 8;
    world.setFitInsets(bar ? bar.bottom + gap : 0, innerHeight - low + gap);
  };
  const resize = () => {
    world.resize(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight);
    insets();
    world.fit();
  };
  resize();
  addEventListener('resize', resize);

  let fitted = false;
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(100, now - last);
    last = now;
    const target = clock.advance(dt, runtime.peek(), runtime.state.now);
    runtime.runUntil(target, clock.limit);
    if (runtime.done && clock.playing) clock.pause();
    world.update(dt, clock.progress(runtime.peek(), runtime.state.now));
    ui.update();
    // Refit once the panels have their first real size.
    if (!fitted) {
      fitted = true;
      resize();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Hooks for the browser smoke test.
  (globalThis as { __lkc?: unknown }).__lkc = {
    runtime,
    clock,
    bus,
    log: ui.log,
  };
  document.getElementById('status')?.setAttribute('data-ready', 'true');
}

boot();
