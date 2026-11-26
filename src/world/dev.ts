// Dev-only harness to eyeball the world against the WP0 fixture, without the
// UI. main.ts can load it behind a URL parameter (see the WP3 report).
//
// Keys: space play/pause, right arrow or n step, r reset, t theme,
// m event-paced / time-true. URL: ?noS drops tier S events.
// Logs frames per second to the console every 2 s and keeps the last figure
// in window.__lkcFps.

import fixture from '../../test/fixtures/cold-warm-read.events.json';
import { Bus } from '../core/bus';
import { FixtureSource, type EventFile } from '../core/fixtureSource';
import { Runtime } from '../core/runtime';
import { PresentationClock } from '../core/timebase';
import { createWorld, type ThemeSetting } from './index';

export function startDev(canvas: HTMLCanvasElement, file: EventFile = fixture as unknown as EventFile): () => void {
  const params = new URLSearchParams(globalThis.location?.search ?? '');
  const events = params.has('noS') ? file.events.filter((e) => e.tier !== 'S') : file.events;
  const bus = new Bus();
  const runtime = new Runtime(new FixtureSource({ header: file.header, events }), bus);
  const clock = new PresentationClock();
  const world = createWorld(canvas, bus, () => runtime.state);

  const size = () => world.resize(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight);
  if (!canvas.style.width) Object.assign(canvas.style, { width: '100vw', height: '100vh', display: 'block' });
  size();
  addEventListener('resize', size);

  bus.on('select', (s) => console.info('select', s));
  bus.on('kevent', ({ event }) => console.debug(event.seq, event.type, event));

  let theme: ThemeSetting = 'auto';
  const onKey = (e: KeyboardEvent) => {
    if (e.key === ' ') {
      e.preventDefault();
      if (clock.playing) clock.pause();
      else clock.play();
    } else if (e.key === 'ArrowRight' || e.key === 'n') {
      clock.requestStep();
    } else if (e.key === 'r') {
      clock.reset();
      runtime.reset();
    } else if (e.key === 't') {
      theme = theme === 'dark' ? 'light' : 'dark';
      world.setTheme(theme);
    } else if (e.key === 'm') {
      clock.setMode(clock.mode === 'time' ? 'event' : 'time');
      clock.play();
    }
  };
  addEventListener('keydown', onKey);

  let last = performance.now();
  let frames = 0;
  let fpsT0 = last;
  let raf = 0;
  const frame = (now: number) => {
    const dt = Math.min(100, now - last);
    last = now;
    const target = clock.advance(dt, runtime.peek(), runtime.state.now);
    runtime.runUntil(target);
    world.update(dt, clock.progress(runtime.peek(), runtime.state.now));
    frames++;
    if (now - fpsT0 >= 2000) {
      const fps = (frames * 1000) / (now - fpsT0);
      (globalThis as { __lkcFps?: number }).__lkcFps = fps;
      console.info(`world: ${fps.toFixed(1)} fps`);
      frames = 0;
      fpsT0 = now;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  clock.play();

  return () => {
    cancelAnimationFrame(raf);
    removeEventListener('resize', size);
    removeEventListener('keydown', onKey);
    world.dispose();
  };
}
