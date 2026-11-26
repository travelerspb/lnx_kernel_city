// Pure maths for the top-down orthographic camera. No three.js here, so it
// can be tested in node. Screen up is north (-Z); screen right is +X.

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface View {
  /** World point at the centre of the screen. */
  cx: number;
  cz: number;
  /** Half the visible height in world units. Smaller is closer. */
  halfH: number;
}

export interface ViewLimits {
  minHalfH: number;
  maxHalfH: number;
  /** The centre may not leave this rectangle. */
  bounds: Rect;
}

/** View that shows the whole rectangle at the given aspect (width / height). */
export function fitView(b: Rect, aspect: number, margin = 1.04): View {
  const halfW = (b.maxX - b.minX) / 2;
  const halfH = (b.maxZ - b.minZ) / 2;
  return {
    cx: (b.minX + b.maxX) / 2,
    cz: (b.minZ + b.maxZ) / 2,
    halfH: Math.max(halfH, halfW / Math.max(aspect, 1e-6)) * margin,
  };
}

/** Like fitView, but keeps the rectangle inside the screen band between
 *  `top` and `bottom` pixels of padding (for panels drawn over the map). */
export function fitViewInset(b: Rect, width: number, height: number, top: number, bottom: number): View {
  const free = Math.max(1, height - top - bottom);
  const v = fitView(b, width / free);
  const halfH = (v.halfH * height) / free;
  const worldPerPx = (2 * halfH) / height;
  // The free band's centre is (top - bottom) / 2 px below the screen centre.
  return { cx: v.cx, cz: v.cz - ((top - bottom) / 2) * worldPerPx, halfH };
}

export function frustum(v: View, aspect: number): { left: number; right: number; top: number; bottom: number } {
  const halfW = v.halfH * aspect;
  return { left: -halfW, right: halfW, top: v.halfH, bottom: -v.halfH };
}

/** Normalised device coordinates (-1..1, y up) to a world point on the ground. */
export function ndcToWorld(v: View, aspect: number, nx: number, ny: number): { x: number; z: number } {
  return { x: v.cx + nx * v.halfH * aspect, z: v.cz - ny * v.halfH };
}

export function clampView(v: View, lim: ViewLimits): View {
  return {
    cx: Math.min(lim.bounds.maxX, Math.max(lim.bounds.minX, v.cx)),
    cz: Math.min(lim.bounds.maxZ, Math.max(lim.bounds.minZ, v.cz)),
    halfH: Math.min(lim.maxHalfH, Math.max(lim.minHalfH, v.halfH)),
  };
}

/** Zoom by `factor` (< 1 zooms in) keeping the world point under (nx, ny) fixed. */
export function zoomAt(v: View, aspect: number, nx: number, ny: number, factor: number, lim: ViewLimits): View {
  const halfH = Math.min(lim.maxHalfH, Math.max(lim.minHalfH, v.halfH * factor));
  const before = ndcToWorld(v, aspect, nx, ny);
  const scaled = { ...v, halfH };
  const after = ndcToWorld(scaled, aspect, nx, ny);
  return clampView({ cx: v.cx + before.x - after.x, cz: v.cz + before.z - after.z, halfH }, lim);
}

/** Pan so that the ground follows a pointer drag of (dnx, dny) in NDC. */
export function panBy(v: View, aspect: number, dnx: number, dny: number, lim: ViewLimits): View {
  return clampView({ cx: v.cx - dnx * v.halfH * aspect, cz: v.cz + dny * v.halfH, halfH: v.halfH }, lim);
}
