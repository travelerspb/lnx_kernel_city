// Pointer input on the canvas: drag to pan, wheel or pinch to zoom, click to
// select, move to hover. Reports pointer positions in NDC.

import { panBy, zoomAt } from './cameraMath';
import type { Engine } from './renderer';

export interface ControlHandlers {
  click(nx: number, ny: number): void;
  hover(nx: number, ny: number): void;
  leave(): void;
}

const DRAG_PX = 5;

export function attachControls(engine: Engine, h: ControlHandlers): () => void {
  const el = engine.canvas;
  const pointers = new Map<number, { x: number; y: number }>();
  let downAt: { x: number; y: number } | null = null;
  let dragged = false;
  let pinch: number | null = null;

  const ndc = (clientX: number, clientY: number) => {
    const r = el.getBoundingClientRect();
    return {
      nx: ((clientX - r.left) / Math.max(1, r.width)) * 2 - 1,
      ny: -(((clientY - r.top) / Math.max(1, r.height)) * 2 - 1),
    };
  };
  const toNdcDelta = (dx: number, dy: number) => {
    const r = el.getBoundingClientRect();
    return { dnx: (dx / Math.max(1, r.width)) * 2, dny: -(dy / Math.max(1, r.height)) * 2 };
  };

  const onDown = (e: PointerEvent) => {
    el.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      downAt = { x: e.clientX, y: e.clientY };
      dragged = false;
    } else {
      dragged = true;
      pinch = null;
    }
  };

  const onMove = (e: PointerEvent) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) {
      const p = ndc(e.clientX, e.clientY);
      h.hover(p.nx, p.ny);
      return;
    }
    if (pointers.size === 2) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinch !== null && d > 0) {
        const mid = ndc((a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
        engine.setView(zoomAt(engine.view, engine.aspect, mid.nx, mid.ny, pinch / d, engine.limits));
      }
      pinch = d;
      return;
    }
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > DRAG_PX) dragged = true;
    if (dragged) {
      const { dnx, dny } = toNdcDelta(e.clientX - prev.x, e.clientY - prev.y);
      engine.setView(panBy(engine.view, engine.aspect, dnx, dny, engine.limits));
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  const onUp = (e: PointerEvent) => {
    const had = pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (had && pointers.size === 0) {
      if (!dragged) {
        const p = ndc(e.clientX, e.clientY);
        h.click(p.nx, p.ny);
      }
      downAt = null;
    }
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = ndc(e.clientX, e.clientY);
    const factor = Math.exp(e.deltaY * 0.0015);
    engine.setView(zoomAt(engine.view, engine.aspect, p.nx, p.ny, factor, engine.limits));
  };

  const onLeave = () => h.leave();

  el.style.touchAction = 'none';
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('pointerleave', onLeave);
  el.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    el.removeEventListener('pointerleave', onLeave);
    el.removeEventListener('wheel', onWheel);
  };
}
