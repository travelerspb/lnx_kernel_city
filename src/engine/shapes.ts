// Flat geometry for markers, lying on the ground plane (XZ) and facing up.
// Shapes are built in XY and rotated so +Y points north (-Z).

import { BufferGeometry, PlaneGeometry, Shape as TShape, ShapeGeometry, Path } from 'three';

export type ShapeKind = 'circle' | 'diamond' | 'hexagon' | 'square' | 'triangle';

/** Corner points of a shape of "radius" r, counter-clockwise. */
export function polygon(kind: ShapeKind, r: number): Array<[number, number]> {
  const reg = (n: number, start: number, rr: number) =>
    Array.from({ length: n }, (_, i) => {
      const a = start + (i * 2 * Math.PI) / n;
      return [Math.cos(a) * rr, Math.sin(a) * rr] as [number, number];
    });
  switch (kind) {
    case 'circle':
      return reg(36, 0, r);
    case 'diamond':
      return reg(4, Math.PI / 2, r * 1.15);
    case 'hexagon':
      return reg(6, 0, r);
    case 'square':
      return reg(4, Math.PI / 4, r * 1.2);
    case 'triangle':
      return reg(3, Math.PI / 2, r * 1.25);
  }
}

function toShape(pts: Array<[number, number]>): TShape {
  const s = new TShape();
  pts.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
  s.closePath();
  return s;
}

function flat<T extends BufferGeometry>(g: T): T {
  g.rotateX(-Math.PI / 2);
  return g;
}

const cache = new Map<string, BufferGeometry>();
function cached(key: string, make: () => BufferGeometry): BufferGeometry {
  let g = cache.get(key);
  if (!g) {
    g = make();
    cache.set(key, g);
  }
  return g;
}

export function solidGeometry(kind: ShapeKind, r: number): BufferGeometry {
  return cached(`solid:${kind}:${r}`, () => flat(new ShapeGeometry(toShape(polygon(kind, r)))));
}

/** Outline band of width w just inside radius r. */
export function outlineGeometry(kind: ShapeKind, r: number, w: number): BufferGeometry {
  return cached(`outline:${kind}:${r}:${w}`, () => {
    const s = toShape(polygon(kind, r));
    const inner = polygon(kind, Math.max(0.01, r - w)).reverse();
    const hole = new Path();
    inner.forEach(([x, y], i) => (i === 0 ? hole.moveTo(x, y) : hole.lineTo(x, y)));
    hole.closePath();
    s.holes.push(hole);
    return flat(new ShapeGeometry(s));
  });
}

/** Axis-aligned rectangle centred on the origin, w along X, h along Z. */
export function rectGeometry(w: number, h: number): BufferGeometry {
  return cached(`rect:${w}:${h}`, () => flat(new PlaneGeometry(w, h)));
}

/** A unit plane for strips that are scaled per use (roads, walls). */
export function unitRect(): BufferGeometry {
  return cached('unit', () => flat(new PlaneGeometry(1, 1)));
}

export function disposeShapes(): void {
  for (const g of cache.values()) g.dispose();
  cache.clear();
}
