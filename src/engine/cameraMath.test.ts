import { describe, expect, it } from 'vitest';
import { fitView, fitViewInset, frustum, ndcToWorld, panBy, zoomAt, type ViewLimits } from './cameraMath';

const lim: ViewLimits = { minHalfH: 5, maxHalfH: 100, bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 40 } };

describe('camera maths', () => {
  it('fits a rectangle, tall or wide', () => {
    const b = { minX: -60, maxX: 60, minZ: -60, maxZ: 40 };
    const wide = fitView(b, 2, 1);
    expect(wide).toEqual({ cx: 0, cz: -10, halfH: 50 });
    const tall = fitView(b, 0.5, 1);
    expect(tall.halfH).toBe(120);
    expect(frustum(wide, 2)).toEqual({ left: -100, right: 100, top: 50, bottom: -50 });
  });

  it('fits a rectangle into the band between top and bottom insets', () => {
    const b = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
    // 100 x 200 px screen, 50 px covered at the top, none at the bottom.
    const v = fitViewInset(b, 100, 200, 50, 0);
    expect(fitViewInset(b, 100, 200, 0, 0)).toEqual(fitView(b, 0.5));
    // Map top edge sits at the inset line, bottom edge above the screen bottom.
    const worldPerPx = (2 * v.halfH) / 200;
    expect(v.cz - v.halfH + 50 * worldPerPx).toBeLessThanOrEqual(b.minZ + 1e-9);
    expect(v.cz + v.halfH).toBeGreaterThanOrEqual(b.maxZ);
  });

  it('maps screen top to north (-Z) and screen right to +X', () => {
    const v = { cx: 0, cz: 0, halfH: 10 };
    expect(ndcToWorld(v, 1, 0, 1)).toEqual({ x: 0, z: -10 });
    expect(ndcToWorld(v, 1, 1, 0)).toEqual({ x: 10, z: 0 });
  });

  it('zooms about the pointer', () => {
    const v = { cx: 0, cz: 0, halfH: 20 };
    const p = ndcToWorld(v, 1.5, 0.5, -0.5);
    const z = zoomAt(v, 1.5, 0.5, -0.5, 0.5, lim);
    expect(z.halfH).toBe(10);
    const q = ndcToWorld(z, 1.5, 0.5, -0.5);
    expect(q.x).toBeCloseTo(p.x);
    expect(q.z).toBeCloseTo(p.z);
    expect(zoomAt(v, 1, 0, 0, 0.01, lim).halfH).toBe(5);
  });

  it('pans with the drag and stays in bounds', () => {
    const v = { cx: 0, cz: 0, halfH: 10 };
    // Dragging right moves the camera west.
    expect(panBy(v, 1, 0.5, 0, lim).cx).toBe(-5);
    // Dragging up moves the camera south.
    expect(panBy(v, 1, 0, 0.5, lim).cz).toBe(5);
    expect(panBy(v, 1, -100, 0, lim).cx).toBe(60);
  });
});
