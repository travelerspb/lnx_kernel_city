// Shared drawing helpers for districts and entities: themed materials,
// labels, markers built from the look table, plots and pads. The world is
// flat; height only orders layers (layout.LAYERS).

import { Group, Mesh, MeshBasicMaterial, type Object3D } from 'three';
import type { Selection, StationId } from '../core/types';
import type { Picker } from '../engine/picking';
import { outlineGeometry, rectGeometry, solidGeometry, unitRect } from '../engine/shapes';
import { Label } from '../engine/text';
import { LAYERS, SIZES, padLabelPoint, stationPoint, type Bounds, type Point } from './layout';
import { LOOKS, PALETTE, colour, type LookId, type Role, type Theme } from './palette';

export class Materials {
  private readonly mats = new Map<string, { role: Role; mat: MeshBasicMaterial }>();

  constructor(private theme: Theme) {}

  get(role: Role, opacity = 1): MeshBasicMaterial {
    const key = `${role}:${opacity}`;
    let e = this.mats.get(key);
    if (!e) {
      const mat = new MeshBasicMaterial({
        color: colour(this.theme, role),
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity >= 1,
      });
      e = { role, mat };
      this.mats.set(key, e);
    }
    return e.mat;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    for (const { role, mat } of this.mats.values()) mat.color.setHex(colour(theme, role));
  }

  dispose(): void {
    for (const { mat } of this.mats.values()) mat.dispose();
    this.mats.clear();
  }
}

export interface LabelOptions {
  size?: number;
  role?: Role;
  bold?: boolean;
  align?: 'left' | 'centre';
}

/** Everything a district or the entity layer needs to draw. */
export class WorldCtx {
  readonly root = new Group();
  private readonly labels: Array<{ label: Label; role: Role }> = [];

  constructor(
    readonly mats: Materials,
    readonly picker: Picker,
    public theme: Theme,
  ) {}

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.mats.setTheme(theme);
    for (const { label, role } of this.labels) label.setColour(PALETTE[theme][role]);
  }

  add<T extends Object3D>(o: T, parent: Object3D = this.root): T {
    parent.add(o);
    return o;
  }

  label(text: string, at: Point, o: LabelOptions = {}, parent: Object3D = this.root): Label {
    const role = o.role ?? 'text';
    const l = new Label(text, {
      size: o.size ?? SIZES.label,
      colour: PALETTE[this.theme][role],
      bold: o.bold ?? false,
      align: o.align ?? 'centre',
    });
    l.sprite.position.set(at.x, LAYERS.label, at.z);
    this.labels.push({ label: l, role });
    parent.add(l.sprite);
    return l;
  }

  /** Remove a label made by this context and free it. */
  dropLabel(l: Label): void {
    const i = this.labels.findIndex((x) => x.label === l);
    if (i >= 0) this.labels.splice(i, 1);
    l.sprite.removeFromParent();
    l.dispose();
  }

  /** Change the role (colour) of a label made by this context. */
  relabel(l: Label, text: string, role: Role): void {
    const e = this.labels.find((x) => x.label === l);
    if (e) e.role = role;
    l.set(text, PALETTE[this.theme][role]);
  }

  /** Filled rectangle. */
  rect(b: Bounds, role: Role, layer: number, parent: Object3D = this.root): Mesh {
    const m = new Mesh(rectGeometry(b.maxX - b.minX, b.maxZ - b.minZ), this.mats.get(role));
    m.position.set((b.minX + b.maxX) / 2, layer, (b.minZ + b.maxZ) / 2);
    parent.add(m);
    return m;
  }

  /** Rectangle border of width w, inside the bounds. */
  frame(b: Bounds, role: Role, w: number, layer: number, parent: Object3D = this.root): Group {
    const g = new Group();
    const { minX, maxX, minZ, maxZ } = b;
    this.rect({ minX, maxX, minZ, maxZ: minZ + w }, role, layer, g);
    this.rect({ minX, maxX, minZ: maxZ - w, maxZ }, role, layer, g);
    this.rect({ minX, maxX: minX + w, minZ, maxZ }, role, layer, g);
    this.rect({ minX: maxX - w, maxX, minZ, maxZ }, role, layer, g);
    parent.add(g);
    return g;
  }

  /** A straight strip of width w from a to b. */
  strip(a: Point, b: Point, w: number, role: Role, layer: number, parent: Object3D = this.root): Mesh {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const m = new Mesh(unitRect(), this.mats.get(role));
    m.scale.set(len + w, 1, w);
    m.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    m.position.set((a.x + b.x) / 2, layer, (a.z + b.z) / 2);
    parent.add(m);
    return m;
  }

  pickable(o: Object3D, sel: Selection): void {
    this.picker.add(o, sel);
  }

  /** A station pad: a square plate with its name, selectable. */
  pad(station: StationId, name: string, parent: Object3D = this.root): { pad: Mesh; label: Label } {
    const p = stationPoint(station);
    const s = SIZES.stationPad;
    const pad = this.rect({ minX: p.x - s, maxX: p.x + s, minZ: p.z - s, maxZ: p.z + s }, 'pad', LAYERS.pad, parent);
    this.pickable(pad, { kind: 'station', station });
    const label = this.label(name, padLabelPoint(station), { size: SIZES.smallLabel, role: 'text.muted' }, parent);
    return { pad, label };
  }

  marker(size: number, parent: Object3D = this.root): Marker {
    const m = new Marker(this, size);
    parent.add(m.group);
    return m;
  }

  dispose(): void {
    for (const { label } of this.labels) label.dispose();
    this.labels.length = 0;
    this.picker.clear();
    this.root.removeFromParent();
  }
}

/** A flat entity drawn from a row of the look table: body, outline, glyph. */
export class Marker {
  readonly group = new Group();
  private readonly under: Mesh;
  private readonly body: Mesh;
  private readonly glyph = new Group();
  look: LookId | null = null;

  constructor(
    private readonly ctx: WorldCtx,
    readonly size: number,
  ) {
    const mats = ctx.mats;
    this.under = new Mesh(solidGeometry('circle', size), mats.get('outline'));
    this.under.position.y = -0.002;
    this.body = new Mesh(solidGeometry('circle', size), mats.get('ink'));
    this.glyph.position.y = 0.002;
    this.group.add(this.under, this.body, this.glyph);
  }

  setLook(id: LookId): void {
    if (this.look === id) return;
    this.look = id;
    const look = LOOKS[id];
    const r = this.size;
    const mats = this.ctx.mats;
    if (look.hollow) {
      this.body.geometry = outlineGeometry(look.shape, r, r * 0.3);
      this.under.visible = false;
    } else {
      this.body.geometry = solidGeometry(look.shape, r);
      this.under.geometry = solidGeometry(look.shape, r + SIZES.outline);
      this.under.visible = true;
    }
    this.body.material = mats.get(look.role);
    this.glyph.clear();
    const on = mats.get(look.hollow ? look.role : 'glyph');
    const put = (geo: Mesh['geometry'], x = 0, z = 0, rot = 0, mat = on) => {
      const m = new Mesh(geo, mat);
      m.position.set(x, 0, z);
      m.rotation.y = rot;
      this.glyph.add(m);
    };
    switch (look.glyph) {
      case 'none':
        break;
      case 'ring':
        put(outlineGeometry('circle', r * 1.8, r * 0.24), 0, 0, 0, mats.get(look.role));
        break;
      case 'bar':
        put(rectGeometry(r * 1.4, r * 0.34));
        break;
      case 'pause':
        put(rectGeometry(r * 0.3, r * 1.0), -r * 0.28);
        put(rectGeometry(r * 0.3, r * 1.0), r * 0.28);
        break;
      case 'dot':
        put(solidGeometry('circle', r * 0.36));
        break;
      case 'tri':
        put(solidGeometry('triangle', r * 0.45));
        break;
      case 'box':
        put(solidGeometry('square', r * 0.36));
        break;
      case 'cross':
        put(rectGeometry(r * 1.4, r * 0.26), 0, 0, Math.PI / 4);
        put(rectGeometry(r * 1.4, r * 0.26), 0, 0, -Math.PI / 4);
        break;
    }
  }

  setPos(p: Point, layer: number): void {
    this.group.position.set(p.x, layer, p.z);
  }
}
