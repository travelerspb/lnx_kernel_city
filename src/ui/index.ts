// UI shell: transport bar, clock readout, event log, inspector, legend.
//
// Talks to the rest of the city only through the bus (emits `transport`,
// `select`, `hover`, `focus`; listens to `kevent`, `sim:reset`, `sim:end`,
// `select`) and by reading state and the presentation clock. It never
// mutates either. No three.js, nothing from src/world or src/engine.

import '../styles/ui.css';
import type { Bus } from '../core/bus';
import type { KernelState, PresentationMode, Selection, TransportCommand } from '../core/types';
import { h } from './dom';
import { loadEvidenceIndex, type EvidenceIndex } from './evidence';
import { TIER_LABEL, formatNs, formatNsExact } from './format';
import { info, stationInfo } from '../core/glossary';
import { inspectorView, type AboutView, type InspectorView } from './inspectorModel';
import { renderLegend } from './legend';
import { LogModel, matchesFlow, type FlowFilter, type LogRow } from './logModel';
import {
  MODES,
  SLIDER_MAX,
  keyCommand,
  nsPerMsToSlider,
  sliderToNsPerMs,
  toggleCommand,
  transportView,
  type ClockView,
} from './transport';

export type { ClockView } from './transport';
export type { EvidenceIndex } from './evidence';
export { loadEvidenceIndex } from './evidence';

export interface UiDeps {
  /** Current kernel state, read-only. Null before the runtime exists. */
  getState(): Readonly<KernelState> | null;
  /** The presentation clock (PresentationClock satisfies ClockView). */
  getClock(): ClockView;
  /**
   * The evidence index as an object or a promise. When left out, the UI
   * fetches `evidenceUrl`. Absent or failed: rows show "no evidence".
   */
  evidenceIndex?: EvidenceIndex | null | Promise<EvidenceIndex | null>;
  /** Default 'evidence/index.json', relative to the page. */
  evidenceUrl?: string;
  /** Prefix for evidence links. Default 'evidence/'. */
  evidenceBase?: string;
  /** Maximum rows kept in the log. Default 2000. */
  logCap?: number;
  /** Document for keyboard shortcuts. Default root.ownerDocument. */
  keyboardTarget?: Document | HTMLElement;
}

export interface UiHandle {
  /** Call once per frame. Cheap when nothing changed. */
  update(): void;
  dispose(): void;
  /** The log data, for tests and the smoke test. */
  readonly log: LogModel;
}

function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function parseFilter(v: string): FlowFilter {
  if (v === 'all' || v === 'none') return v;
  const n = Number(v);
  return Number.isInteger(n) ? n : 'all';
}

let instances = 0;

export function createUi(root: HTMLElement, bus: Bus, deps: UiDeps): UiHandle {
  const doc = root.ownerDocument;
  const log = new LogModel(null, deps.evidenceBase ?? 'evidence/', deps.logCap);
  const unsubs: Array<() => void> = [];
  let selection: Selection | null = null;
  let ended = false;
  let disposed = false;

  const emit = (cmd: TransportCommand) => bus.emit('transport', cmd);

  // ---------------------------------------------------------------- transport
  const playBtn = h('button', { type: 'button', class: 'lkc-btn lkc-btn-play', 'aria-keyshortcuts': 'Space' }, 'Play');
  const stepBtn = h('button', { type: 'button', class: 'lkc-btn', 'aria-keyshortcuts': 'ArrowRight', title: 'Step one event (→)' }, 'Step');
  const resetBtn = h('button', { type: 'button', class: 'lkc-btn', 'aria-keyshortcuts': 'R', title: 'Reset (r)' }, 'Reset');
  playBtn.addEventListener('click', () => emit(toggleCommand(deps.getClock())));
  stepBtn.addEventListener('click', () => emit({ action: 'step' }));
  resetBtn.addEventListener('click', () => emit({ action: 'reset' }));

  const modeInputs = new Map<PresentationMode, HTMLInputElement>();
  const modeSet = h('fieldset', { class: 'lkc-modes' }, h('legend', { class: 'lkc-sr' }, 'Presentation mode'));
  const modeName = `lkc-mode-${++instances}`;
  for (const m of MODES) {
    const input = h('input', { type: 'radio', name: modeName, value: m.mode });
    input.addEventListener('change', () => {
      if (input.checked) emit({ action: 'mode', mode: m.mode });
    });
    modeInputs.set(m.mode, input);
    modeSet.append(h('label', { class: 'lkc-mode', title: m.hint }, input, h('span', {}, m.label)));
  }

  const speedId = `${modeName}-speed`;
  const speed = h('input', { type: 'range', id: speedId, min: 0, max: SLIDER_MAX, step: 1, 'aria-describedby': `${speedId}-out` });
  const speedOut = h('output', { id: `${speedId}-out`, for: speedId, class: 'lkc-speed-out' });
  speed.addEventListener('input', () => emit({ action: 'speed', value: sliderToNsPerMs(Number(speed.value)) }));
  const speedBox = h('div', { class: 'lkc-speed' }, h('label', { for: speedId }, 'Speed'), speed, speedOut);

  const clockNow = h('span', { class: 'lkc-clock-now' });
  const clockExact = h('span', { class: 'lkc-clock-exact lkc-muted' });
  const clockSkip = h('span', { class: 'lkc-clock-skip' });
  const clockSeq = h('span', { class: 'lkc-clock-seq lkc-muted' });
  const clock = h(
    'div',
    { class: 'lkc-clock', role: 'group', 'aria-label': 'Simulation clock' },
    h('span', { class: 'lkc-muted' }, 'sim time '),
    clockNow,
    clockExact,
    clockSkip,
    clockSeq,
  );

  const bar = h(
    'header',
    { class: 'lkc-bar lkc-panel' },
    h('div', { class: 'lkc-transport', role: 'toolbar', 'aria-label': 'Transport' }, playBtn, stepBtn, resetBtn),
    modeSet,
    speedBox,
    clock,
  );

  // --------------------------------------------------------------------- log
  const filter = h('select', { 'aria-label': 'Filter log by flow' }, h('option', { value: 'all' }, 'All flows'));
  filter.addEventListener('change', () => log.setFilter(parseFilter(filter.value)));
  const logCount = h('span', { class: 'lkc-muted' });
  const tbody = h('tbody');
  const table = h(
    'table',
    { class: 'lkc-log-table' },
    h('caption', { class: 'lkc-sr' }, 'Applied kernel events, oldest first'),
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        ...['seq', 'time', 'cpu', 'task', 'type', 'tier', 'detail', 'evidence'].map((c) => h('th', { scope: 'col', class: `lkc-col-${c}`, title: c }, c === 'evidence' ? '§' : c)),
      ),
    ),
    tbody,
  );
  const scroller = h('div', { class: 'lkc-log-scroll', tabindex: 0, 'aria-label': 'Event log rows' }, table);
  const logEl = h(
    'details',
    { class: 'lkc-log lkc-panel' },
    h('summary', {}, h('h2', {}, 'Event log'), ' ', logCount),
    h('div', { class: 'lkc-log-tools' }, filter),
    scroller,
  );
  const wide = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 720px)').matches : true;
  logEl.open = wide;

  const rowEls = new Map<number, HTMLTableRowElement>();
  let renderedVersion = -1;
  let renderedFilter: FlowFilter = 'all';
  let renderedIndex: EvidenceIndex | null = null;
  let renderedGeneration = -1;
  let lastRenderedSeq = -1;
  let flowsShown = '';
  let currentSeq = -1;
  let selectedSeq = -1;

  function rowEl(r: LogRow): HTMLTableRowElement {
    const ev = r.evidence
      ? h(
          'a',
          {
            href: r.evidence.href,
            target: '_blank',
            rel: 'noopener',
            class: `lkc-ev lkc-ev-${r.evidence.status}`,
            title: `${r.evidence.label} (${r.evidence.status})`,
            'aria-label': `Evidence for ${r.type}: ${r.evidence.label}, ${r.evidence.status}`,
          },
          r.evidence.status === 'verified' ? '§' : r.evidence.status === 'drop' ? '§✕' : '§?',
        )
      : h('span', { class: 'lkc-ev lkc-ev-missing', title: 'No evidence entry', 'aria-label': 'No evidence entry' }, '∅');
    const tr = h(
      'tr',
      { 'data-seq': r.seq, tabindex: -1, class: 'lkc-row' },
      h('td', { class: 'lkc-col-seq' }, String(r.seq)),
      h('td', { class: 'lkc-col-time' }, r.tsText),
      h('td', { class: 'lkc-col-cpu' }, String(r.cpu)),
      h('td', { class: 'lkc-col-task', title: r.task }, r.task),
      h('td', { class: 'lkc-col-type', title: r.type }, r.type),
      h('td', { class: 'lkc-col-tier' }, h('span', { class: `lkc-tier lkc-tier-${r.tier}`, title: TIER_LABEL[r.tier], 'aria-label': `tier ${r.tier}, ${TIER_LABEL[r.tier]}` }, r.tier)),
      h('td', { class: 'lkc-col-detail', title: r.text }, r.text),
      h('td', { class: 'lkc-col-evidence' }, ev),
    );
    return tr;
  }

  function syncFlows(): void {
    const flows = log.flows;
    const key = flows.join(',');
    if (key === flowsShown) return;
    flowsShown = key;
    const keep = filter.value;
    filter.replaceChildren(
      h('option', { value: 'all' }, 'All flows'),
      ...flows.map((f) => h('option', { value: String(f) }, `Flow #${f}`)),
      h('option', { value: 'none' }, 'No flow'),
    );
    filter.value = [...filter.options].some((o) => o.value === keep) ? keep : 'all';
    if (filter.value !== keep) log.setFilter(parseFilter(filter.value));
  }

  function renderLog(): void {
    if (log.version === renderedVersion) return;
    syncFlows();
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
    const full = log.filter !== renderedFilter || log.evidenceIndex !== renderedIndex || log.generation !== renderedGeneration;
    if (full) {
      rowEls.clear();
      tbody.replaceChildren();
      lastRenderedSeq = -1;
    }
    const frag = doc.createDocumentFragment();
    for (const r of log.rows) {
      if (r.seq <= lastRenderedSeq) continue;
      if (!matchesFlow(r, log.filter)) continue;
      const tr = rowEl(r);
      rowEls.set(r.seq, tr);
      frag.append(tr);
    }
    tbody.append(frag);
    // Drop rows the model has dropped because of its cap.
    const first = log.rows[0]?.seq ?? Infinity;
    for (const [seq, tr] of rowEls) {
      if (seq >= first) break;
      tr.remove();
      rowEls.delete(seq);
    }
    lastRenderedSeq = log.current?.seq ?? -1;
    renderedFilter = log.filter;
    renderedIndex = log.evidenceIndex;
    renderedGeneration = log.generation;
    renderedVersion = log.version;
    const shown = rowEls.size;
    setText(logCount, log.dropped > 0 ? `(${shown} shown, ${log.dropped} older dropped)` : `(${shown})`);
    markRows(true);
    if (atBottom || full) scroller.scrollTop = scroller.scrollHeight;
  }

  function markRows(force = false): void {
    const cur = log.current?.seq ?? -1;
    const sel = selection?.kind === 'event' ? selection.seq : -1;
    if (!force && cur === currentSeq && sel === selectedSeq) return;
    rowEls.get(currentSeq)?.classList.remove('lkc-current');
    rowEls.get(currentSeq)?.removeAttribute('aria-current');
    rowEls.get(selectedSeq)?.classList.remove('lkc-selected');
    rowEls.get(selectedSeq)?.removeAttribute('aria-selected');
    currentSeq = cur;
    selectedSeq = sel;
    const c = rowEls.get(cur);
    c?.classList.add('lkc-current');
    c?.setAttribute('aria-current', 'true');
    const s = rowEls.get(sel);
    s?.classList.add('lkc-selected');
    s?.setAttribute('aria-selected', 'true');
  }

  function rowOf(target: EventTarget | null): LogRow | undefined {
    const tr = target instanceof Element ? target.closest('tr[data-seq]') : null;
    return tr ? log.bySeq(Number(tr.getAttribute('data-seq'))) : undefined;
  }

  function choose(r: LogRow): void {
    bus.emit('select', { kind: 'event', seq: r.seq });
    bus.emit('focus', { station: r.station });
  }

  tbody.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('a')) return;
    const r = rowOf(e.target);
    if (r) choose(r);
  });
  tbody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const r = rowOf(e.target);
    if (r) choose(r);
  });
  let hovered = -1;
  tbody.addEventListener('mouseover', (e) => {
    const r = rowOf(e.target);
    if (!r || r.seq === hovered) return;
    hovered = r.seq;
    bus.emit('hover', { kind: 'event', seq: r.seq });
  });
  tbody.addEventListener('mouseleave', () => {
    hovered = -1;
    bus.emit('hover', null);
  });

  // ---------------------------------------------------------------- inspector
  const inspTitle = h('h2', {}, 'Inspector');
  const inspSub = h('p', { class: 'lkc-muted lkc-insp-sub' });
  const inspList = h('dl', { class: 'lkc-insp-fields' });
  const inspNote = h('p', { class: 'lkc-muted lkc-insp-note' });
  const inspAbout = h('div', { class: 'lkc-insp-about' });
  const clearBtn = h('button', { type: 'button', class: 'lkc-btn lkc-btn-small', 'aria-label': 'Clear selection' }, 'Clear');
  clearBtn.addEventListener('click', () => bus.emit('select', null));
  const inspector = h(
    'section',
    { class: 'lkc-inspector lkc-panel', 'aria-label': 'Inspector', 'aria-live': 'polite' },
    h('div', { class: 'lkc-insp-head' }, inspTitle, clearBtn),
    inspSub,
    inspAbout,
    inspList,
    inspNote,
  );

  const selectButton = (label: string, sel: Selection): HTMLElement => {
    const b = h('button', { type: 'button', class: 'lkc-link' }, label);
    b.addEventListener('click', () => bus.emit('select', sel));
    return b;
  };

  function renderAbout(a: AboutView | undefined): void {
    inspAbout.replaceChildren();
    inspAbout.hidden = !a;
    if (!a) return;
    inspAbout.append(h('p', { class: 'lkc-about-summary' }, a.summary), h('p', {}, a.body));
    if (a.stage) inspAbout.append(h('p', { class: 'lkc-muted' }, `Built in stage ${a.stage}.`));
    if (a.inScenario) inspAbout.append(h('h3', {}, 'In this scenario'), h('p', {}, a.inScenario));
    if (a.source.length > 0) {
      inspAbout.append(h('h3', {}, 'Kernel source (v6.18)'), h('p', { class: 'lkc-about-code' }, ...a.source.flatMap((p, i) => [i ? ', ' : '', h('code', {}, p)])));
    }
    if (a.evidence.length > 0) {
      const ul = h('ul', { class: 'lkc-about-list' });
      for (const e of a.evidence) ul.append(h('li', {}, h('a', { href: e.href, target: '_blank', rel: 'noopener' }, e.label)));
      inspAbout.append(h('h3', {}, 'Evidence'), ul);
    }
    if (a.related.length > 0) {
      const p = h('p', { class: 'lkc-about-related' });
      a.related.forEach((r, i) => p.append(...(i ? [' · '] : []), selectButton(r.label, r.select)));
      inspAbout.append(h('h3', {}, 'See also'), p);
    }
    if (a !== undefined && inspList.childElementCount === 0) inspList.hidden = true;
  }
  let inspKey = '';

  function renderInspector(): void {
    const state = deps.getState();
    const key = `${JSON.stringify(selection)}|${state?.seq ?? -2}|${log.version}`;
    if (key === inspKey) return;
    inspKey = key;
    const v: InspectorView = inspectorView(selection, state, log);
    setText(inspTitle, v.title);
    setText(inspSub, v.subtitle ?? '');
    inspSub.hidden = !v.subtitle;
    setText(inspNote, v.note ?? '');
    inspNote.hidden = !v.note;
    clearBtn.hidden = selection === null;
    inspector.classList.toggle('lkc-insp-empty', selection === null);
    inspList.replaceChildren();
    inspList.hidden = v.fields.length === 0;
    for (const f of v.fields) {
      let value: Node;
      if (f.href) value = h('a', { href: f.href, target: '_blank', rel: 'noopener' }, f.value);
      else if (f.select) {
        const sel = f.select;
        const b = h('button', { type: 'button', class: 'lkc-link' }, f.value);
        b.addEventListener('click', () => bus.emit('select', sel));
        value = b;
      } else value = doc.createTextNode(f.value);
      inspList.append(h('dt', {}, f.label), h('dd', {}, value));
    }
    renderAbout(v.about);
  }

  // ----------------------------------------------------------------- tooltip
  // Map hovers (from the world) show a one-line summary next to the pointer.
  // Log-row hovers do not: the row already says what it is.
  const tip = h('div', { class: 'lkc-tip', role: 'tooltip' });
  tip.hidden = true;
  let pointer = { x: 0, y: 0 };
  const onPointer = (e: Event): void => {
    const pe = e as PointerEvent;
    pointer = { x: pe.clientX, y: pe.clientY };
    if (!tip.hidden) placeTip();
  };
  doc.addEventListener('pointermove', onPointer);
  function placeTip(): void {
    const view = doc.defaultView;
    const w = view?.innerWidth ?? 1e9;
    const hh = view?.innerHeight ?? 1e9;
    const r = tip.getBoundingClientRect();
    const x = Math.min(pointer.x + 14, w - r.width - 8);
    const y = pointer.y + 18 + r.height > hh ? pointer.y - r.height - 10 : pointer.y + 18;
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  }
  function tipText(sel: Selection | null): [string, string] | null {
    if (!sel) return null;
    const state = deps.getState();
    switch (sel.kind) {
      case 'zone':
      case 'district': {
        const e = info(`${sel.kind}:${sel.kind === 'zone' ? sel.zone : sel.district}`);
        return e ? [e.title, e.summary] : null;
      }
      case 'station': {
        const e = stationInfo(sel.station);
        return e ? [e.title, e.summary] : null;
      }
      case 'task': {
        const t = state?.tasks[sel.pid];
        if (!t) return null;
        const st = info(`task-state:${t.state}`);
        const role = info(`task:${t.comm}`);
        const now = `Now: ${t.mode} mode, ${st ? st.summary : t.state}`;
        return [`${t.comm} (pid ${t.pid})`, role ? `${role.summary} ${now}` : now];
      }
      case 'flow': {
        const f = state?.flows[sel.flow];
        return f ? [`${f.name}() request #${f.id}`, info('cargo:request')?.summary ?? ''] : null;
      }
      default:
        return null;
    }
  }
  function showTip(sel: Selection | null): void {
    const t = tipText(sel);
    if (!t) {
      tip.hidden = true;
      return;
    }
    tip.replaceChildren(h('strong', {}, t[0]), h('span', {}, t[1]), h('span', { class: 'lkc-muted lkc-tip-hint' }, 'Click for details'));
    tip.hidden = false;
    placeTip();
  }

  // ------------------------------------------------------------------ legend
  const legend = h('details', { class: 'lkc-legend lkc-panel' }, h('summary', {}, h('h2', {}, 'Legend')), renderLegend());

  root.classList.add('lkc-ui');
  root.append(bar, logEl, inspector, legend, tip);

  // -------------------------------------------------------------- bus wiring
  unsubs.push(
    bus.on('hover', (sel) => showTip(sel)),
    bus.on('kevent', ({ event, state }) => {
      log.push(event, state);
    }),
    bus.on('sim:reset', () => {
      log.clear();
      ended = false;
      // Event seqs and flow ids restart from the beginning, so they would name other things.
      if (selection?.kind === 'event' || selection?.kind === 'flow') bus.emit('select', null);
    }),
    bus.on('sim:end', () => {
      ended = true;
    }),
    bus.on('select', (sel) => {
      selection = sel;
    }),
  );

  // ---------------------------------------------------------------- keyboard
  const keyTarget = deps.keyboardTarget ?? doc;
  const onKey = (e: Event): void => {
    const ke = e as KeyboardEvent;
    const t = ke.target instanceof HTMLElement ? ke.target : null;
    const cmd = keyCommand(
      { key: ke.key, ctrlKey: ke.ctrlKey, metaKey: ke.metaKey, altKey: ke.altKey, targetTag: t?.tagName, targetType: t instanceof HTMLInputElement ? t.type : undefined, targetEditable: t?.isContentEditable ?? false },
      deps.getClock(),
    );
    if (!cmd) return;
    ke.preventDefault();
    if (ke.repeat && cmd.action !== 'step') return;
    emit(cmd);
  };
  // Stop a focused button from also "clicking" on space release.
  const onKeyUp = (e: Event): void => {
    const ke = e as KeyboardEvent;
    if (ke.key === ' ' && ke.target instanceof HTMLButtonElement) ke.preventDefault();
  };
  keyTarget.addEventListener('keydown', onKey);
  keyTarget.addEventListener('keyup', onKeyUp);

  // --------------------------------------------------------- evidence index
  const evSource = deps.evidenceIndex !== undefined ? deps.evidenceIndex : loadEvidenceIndex(deps.evidenceUrl ?? 'evidence/index.json');
  if (evSource instanceof Promise) {
    void evSource.then(
      (idx) => {
        if (!disposed) log.setEvidenceIndex(idx);
      },
      () => undefined,
    );
  } else {
    log.setEvidenceIndex(evSource);
  }

  // ------------------------------------------------------------------ update
  function renderTransport(): void {
    const c = deps.getClock();
    const v = transportView(c, ended);
    setText(playBtn, v.playLabel);
    playBtn.setAttribute('aria-pressed', String(v.playing));
    playBtn.title = `${v.playLabel} (space)`;
    playBtn.disabled = !v.canPlay && !v.playing;
    stepBtn.disabled = !v.canStep;
    for (const [m, input] of modeInputs) if (input.checked !== (m === v.mode)) input.checked = m === v.mode;
    speed.disabled = !v.speedEnabled;
    const pos = String(nsPerMsToSlider(v.nsPerMs));
    if (doc.activeElement !== speed && speed.value !== pos) speed.value = pos;
    setText(speedOut, v.speedText);
    speed.setAttribute('aria-valuetext', v.speedText);

    const state = deps.getState();
    const now = state?.now ?? 0;
    setText(clockNow, formatNs(now));
    setText(clockExact, ` (${formatNsExact(now)})`);
    const showSkip = v.mode === 'event' || c.skippedNs > 0;
    clockSkip.hidden = !showSkip;
    setText(clockSkip, showSkip ? ` · skipped ${formatNs(c.skippedNs)}` : '');
    setText(clockSeq, state ? ` · event ${state.seq < 0 ? '—' : state.seq}${ended ? ' · end' : ''}` : '');
  }

  function update(): void {
    if (disposed) return;
    renderTransport();
    renderLog();
    markRows();
    renderInspector();
  }

  update();

  return {
    update,
    log,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const u of unsubs) u();
      keyTarget.removeEventListener('keydown', onKey);
      keyTarget.removeEventListener('keyup', onKeyUp);
      doc.removeEventListener('pointermove', onPointer);
      root.replaceChildren();
      root.classList.remove('lkc-ui');
    },
  };
}
