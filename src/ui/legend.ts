// Legend: what each colour and shape means. The UI may not import src/world,
// so this table mirrors the looks in src/world/palette.ts (LOOKS) by hand,
// and the colours are CSS custom properties in src/styles/ui.css that mirror
// PALETTE for both themes. Keep the three in step; legend.test.ts pins the
// shape rules. Every entry has a shape or glyph difference, so no meaning
// rests on colour alone (docs/CITY_MAP.md).

import { h, svg } from './dom';
import { TIER_LABEL } from './format';

export type LegendShape = 'circle' | 'diamond' | 'hexagon' | 'square' | 'triangle';
export type LegendGlyph = 'none' | 'ring' | 'bar' | 'pause' | 'dot' | 'tri' | 'box' | 'cross';

export interface LegendItem {
  /** CSS custom property holding the colour, without the leading `--`. */
  token: string;
  shape: LegendShape;
  hollow: boolean;
  glyph: LegendGlyph;
  label: string;
}

export interface LegendGroup {
  title: string;
  items: LegendItem[];
}

const item = (token: string, shape: LegendShape, glyph: LegendGlyph, label: string, hollow = false): LegendItem => ({ token, shape, hollow, glyph, label });

export const LEGEND: readonly LegendGroup[] = [
  {
    title: 'Tasks',
    items: [
      item('lkc-task-user', 'circle', 'none', 'User mode, on a CPU'),
      item('lkc-task-kernel', 'diamond', 'none', 'Kernel mode (process context), on a CPU'),
      item('lkc-task-runnable', 'circle', 'ring', 'Runnable, waiting for a CPU'),
      item('lkc-task-sleeping', 'diamond', 'bar', 'Sleeping (S or D)'),
      item('lkc-task-kernel', 'diamond', 'pause', 'Stopped: an interrupt borrowed its CPU'),
    ],
  },
  {
    title: 'CPUs',
    items: [
      item('lkc-cpu-user', 'hexagon', 'none', 'Running user code'),
      item('lkc-cpu-kernel', 'hexagon', 'dot', 'Running kernel code for a task'),
      item('lkc-cpu-hardirq', 'hexagon', 'tri', 'Hardirq context'),
      item('lkc-cpu-softirq', 'hexagon', 'box', 'Softirq context'),
      item('lkc-cpu-idle', 'hexagon', 'none', 'Idle', true),
    ],
  },
  {
    title: 'Pages and I/O',
    items: [
      item('lkc-page-absent', 'square', 'none', 'Page absent from the cache', true),
      item('lkc-page-locked', 'square', 'cross', 'Page locked for I/O'),
      item('lkc-page-uptodate', 'square', 'dot', 'Page up to date'),
      item('lkc-cargo-inflight', 'triangle', 'none', 'Block request queued'),
      item('lkc-cargo-inflight', 'triangle', 'dot', 'Request issued to the driver'),
      item('lkc-cargo-inflight', 'triangle', 'bar', 'I/O in flight in the device'),
      item('lkc-cargo-done', 'triangle', 'cross', 'Device finished, completion pending'),
      item('lkc-cargo-work', 'triangle', 'ring', "A syscall's work (moves while the task sleeps)", true),
    ],
  },
];

const BODY: Readonly<Record<LegendShape, string>> = {
  circle: 'M8 2 a6 6 0 1 0 0.001 0 Z',
  diamond: 'M8 1 L15 8 L8 15 L1 8 Z',
  hexagon: 'M4.5 2 L11.5 2 L15 8 L11.5 14 L4.5 14 L1 8 Z',
  square: 'M2 2 H14 V14 H2 Z',
  triangle: 'M8 1.5 L15 14.5 H1 Z',
};

function glyphParts(glyph: LegendGlyph, ink: string): Element[] {
  const s = { stroke: ink, 'stroke-width': 1.6, fill: 'none' };
  switch (glyph) {
    case 'none':
      return [];
    case 'ring':
      return [svg('circle', { cx: 8, cy: 8, r: 7.4, ...s, 'stroke-width': 1.2 })];
    case 'bar':
      return [svg('path', { d: 'M5 9 H11', ...s })];
    case 'pause':
      return [svg('path', { d: 'M6.5 5.5 V10.5 M9.5 5.5 V10.5', ...s })];
    case 'dot':
      return [svg('circle', { cx: 8, cy: 9, r: 1.6, fill: ink })];
    case 'tri':
      return [svg('path', { d: 'M8 5.5 L10.5 10 H5.5 Z', fill: ink })];
    case 'box':
      return [svg('path', { d: 'M6 6 H10 V10 H6 Z', fill: ink })];
    case 'cross':
      return [svg('path', { d: 'M5.5 6.5 L10.5 11.5 M10.5 6.5 L5.5 11.5', ...s })];
  }
}

function shapeSvg(it: LegendItem): SVGElement {
  const c = `var(--${it.token})`;
  const body = it.hollow
    ? svg('path', { d: BODY[it.shape], fill: 'none', stroke: c, 'stroke-width': 1.6 })
    : svg('path', { d: BODY[it.shape], fill: c });
  // Glyphs sit on the body: drawn in the background colour on a filled body,
  // in the item colour on a hollow one.
  const ink = it.hollow ? c : 'var(--lkc-glyph)';
  const parts = it.glyph === 'ring' ? [...glyphParts('ring', c), body] : [body, ...glyphParts(it.glyph, ink)];
  return svg('svg', { viewBox: '-1 -1 18 18', width: 18, height: 18, 'aria-hidden': 'true', class: 'lkc-legend-shape' }, ...parts);
}

export function renderLegend(groups: readonly LegendGroup[] = LEGEND): HTMLElement {
  const body = h('div', { class: 'lkc-legend-body' });
  for (const g of groups) {
    const list = h('ul', { class: 'lkc-legend-list' });
    for (const it of g.items) {
      list.append(h('li', { class: 'lkc-legend-item', 'data-shape': it.shape, 'data-glyph': it.glyph }, shapeSvg(it), h('span', {}, it.label)));
    }
    body.append(h('h3', {}, g.title), list);
  }
  const tiers = h('ul', { class: 'lkc-legend-list' });
  for (const t of ['T', 'P', 'S'] as const) {
    tiers.append(h('li', { class: 'lkc-legend-item' }, h('span', { class: `lkc-tier lkc-tier-${t}`, 'aria-hidden': 'true' }, t), h('span', {}, TIER_LABEL[t])));
  }
  tiers.append(
    h('li', { class: 'lkc-legend-item' }, h('span', { class: 'lkc-ev lkc-ev-verified', 'aria-hidden': 'true' }, '§'), h('span', {}, 'Evidence entry, verified')),
    h('li', { class: 'lkc-legend-item' }, h('span', { class: 'lkc-ev lkc-ev-not-verified', 'aria-hidden': 'true' }, '§?'), h('span', {}, 'Evidence not yet verified')),
    h('li', { class: 'lkc-legend-item' }, h('span', { class: 'lkc-ev lkc-ev-missing', 'aria-hidden': 'true' }, '∅'), h('span', {}, 'No evidence entry')),
  );
  body.append(h('h3', {}, 'Event log'), tiers);
  return body;
}

/** Every distinct (shape, hollow, glyph) combination, for the shape test. */
export function legendSignatures(groups: readonly LegendGroup[] = LEGEND): string[] {
  return groups.flatMap((g) => g.items.map((i) => `${i.shape}/${i.hollow ? 'hollow' : 'filled'}/${i.glyph}`));
}
