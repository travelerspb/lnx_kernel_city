// Ray picking against registered objects. Each object carries a Selection;
// the world turns a hit into a bus 'select' or 'hover'.

import { Raycaster, Vector2, type Camera, type Object3D } from 'three';
import type { Selection } from '../core/types';

export class Picker {
  private readonly ray = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly targets = new Map<Object3D, Selection>();

  add(obj: Object3D, sel: Selection): void {
    this.targets.set(obj, sel);
  }

  remove(obj: Object3D): void {
    this.targets.delete(obj);
  }

  clear(): void {
    this.targets.clear();
  }

  /** Topmost selectable object under the NDC point, or null. */
  pick(camera: Camera, nx: number, ny: number): Selection | null {
    this.ndc.set(nx, ny);
    this.ray.setFromCamera(this.ndc, camera);
    const objs = [...this.targets.keys()].filter((o) => isVisible(o));
    // Positions may have changed since the last render.
    for (const o of objs) o.updateWorldMatrix(true, true);
    const hits = this.ray.intersectObjects(objs, true);
    // Hits come nearest first, and nearest is the highest layer.
    for (const h of hits) {
      for (let o: Object3D | null = h.object; o; o = o.parent) {
        const s = this.targets.get(o);
        if (s) return s;
      }
    }
    return null;
  }
}

function isVisible(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

export function sameSelection(a: Selection | null, b: Selection | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
