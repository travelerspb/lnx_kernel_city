// Entry point for main.ts. The world reads KernelState through getState()
// every frame and listens on the bus. It never writes state and never calls
// the sim (ARCHITECTURE.md, rule 3).

import type { Bus } from '../core/bus';
import type { KernelState, Selection } from '../core/types';
import { attachControls } from '../engine/controls';
import { Picker, sameSelection } from '../engine/picking';
import { Engine } from '../engine/renderer';
import { MAP_BOUNDS } from './layout';
import { colour, type Theme } from './palette';
import { WorldScene, safePoint } from './scene';
import { viewOf } from './view';

export type ThemeSetting = Theme | 'auto';

export interface WorldOptions {
  /** 'auto' follows <html data-theme> if set, else prefers-color-scheme. */
  theme?: ThemeSetting;
  /** Wall ms for one move between stations. Default 320. */
  moveMs?: number;
}

export interface World {
  /** Advance animation by wall dtMs and draw. `progress` (0..1) is how far the
   *  presentation clock is through the wait for the next event. */
  update(dtMs: number, progress?: number): void;
  resize(width: number, height: number): void;
  setTheme(theme: ThemeSetting): void;
  /** Show the whole map again. */
  fit(): void;
  /** Pixels at the top and bottom of the canvas that panels cover. */
  setFitInsets(top: number, bottom: number): void;
  dispose(): void;
}

function systemTheme(): Theme {
  const attr = globalThis.document?.documentElement?.dataset['theme'];
  if (attr === 'light' || attr === 'dark') return attr;
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export { WorldScene } from './scene';
export type { WorldView } from './view';
export { LOOKS, PALETTE, type LookId, type Theme } from './palette';

export function createWorld(
  canvas: HTMLCanvasElement,
  bus: Bus,
  getState: () => Readonly<KernelState>,
  opts: WorldOptions = {},
): World {
  let setting: ThemeSetting = opts.theme ?? 'auto';
  const theme: Theme = setting === 'auto' ? systemTheme() : setting;

  const engine = new Engine(canvas, MAP_BOUNDS);
  engine.setBackground(colour(theme, 'ground'));
  const picker = new Picker();
  const scene = new WorldScene(picker, theme, opts.moveMs);
  engine.scene.add(scene.ctx.root);

  let hovered: Selection | null = null;

  const offs: Array<() => void> = [
    bus.on('kevent', ({ event }) => {
      scene.lastEvent = event;
    }),
    bus.on('sim:reset', ({ state }) => {
      scene.reset(viewOf(state));
    }),
    bus.on('select', (s) => {
      scene.selected = s;
    }),
    bus.on('focus', ({ station }) => {
      const p = safePoint(station);
      if (p) engine.setView({ cx: p.x, cz: p.z, halfH: Math.min(engine.view.halfH, 28) });
    }),
  ];

  offs.push(
    attachControls(engine, {
      click(nx, ny) {
        const s = picker.pick(engine.camera, nx, ny);
        bus.emit('select', s);
      },
      hover(nx, ny) {
        const s = picker.pick(engine.camera, nx, ny);
        if (!sameSelection(s, hovered)) {
          hovered = s;
          scene.hovered = s;
          canvas.style.cursor = s ? 'pointer' : '';
          bus.emit('hover', s);
        }
      },
      leave() {
        if (hovered) {
          hovered = null;
          scene.hovered = null;
          bus.emit('hover', null);
        }
      },
    }),
  );

  const applyTheme = (t: Theme) => {
    scene.setTheme(t);
    engine.setBackground(colour(t, 'ground'));
  };
  const onSystemTheme = () => {
    if (setting === 'auto') applyTheme(systemTheme());
  };
  const mq = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  mq?.addEventListener('change', onSystemTheme);
  const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(onSystemTheme);
  mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  offs.push(() => {
    mq?.removeEventListener('change', onSystemTheme);
    mo?.disconnect();
  });

  return {
    update(dtMs, progress = 0) {
      scene.frame(getState(), dtMs, progress);
      engine.render();
    },
    resize(w, h) {
      engine.resize(w, h);
    },
    setTheme(t) {
      setting = t;
      applyTheme(t === 'auto' ? systemTheme() : t);
    },
    fit() {
      engine.fit();
    },
    setFitInsets(top, bottom) {
      engine.setFitInsets(top, bottom);
    },
    dispose() {
      for (const off of offs) off();
      scene.dispose();
      engine.dispose();
    },
  };
}
