// WebGL renderer, scene and a top-down orthographic camera. Kept thin: the
// camera maths is in cameraMath.ts, input in controls.ts, picking in picking.ts.

import { Color, OrthographicCamera, Scene, WebGLRenderer } from 'three';
import { fitView, fitViewInset, frustum, type Rect, type View, type ViewLimits, clampView } from './cameraMath';

export class Engine {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 1, 400);
  view: View;
  aspect = 1;
  private size = { w: 1, h: 1 };
  private insets = { top: 0, bottom: 0 };
  readonly limits: ViewLimits;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly home: Rect,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
    // Straight down; screen up is north (-Z). See cameraMath.ts.
    this.camera.position.set(0, 200, 0);
    this.camera.rotation.set(-Math.PI / 2, 0, 0);
    const span = Math.max(home.maxX - home.minX, home.maxZ - home.minZ);
    // Portrait screens need a larger half-height to fit the map's width.
    this.limits = { minHalfH: 4, maxHalfH: span * 3, bounds: home };
    this.view = fitView(home, 1);
    const w = canvas.clientWidth || canvas.width || 1;
    const h = canvas.clientHeight || canvas.height || 1;
    this.resize(w, h);
    this.fit();
  }

  setBackground(hex: number): void {
    this.scene.background = new Color(hex);
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    this.renderer.setSize(w, h, false);
    this.aspect = w / h;
    this.size = { w, h };
    this.applyView();
  }

  /** Show the whole map. */
  fit(): void {
    const { w, h } = this.size;
    this.setView(fitViewInset(this.home, w, h, this.insets.top, this.insets.bottom));
  }

  /** Screen pixels covered by panels at the top and bottom; fit() keeps the map clear of them. */
  setFitInsets(top: number, bottom: number): void {
    this.insets = { top: Math.max(0, top), bottom: Math.max(0, bottom) };
  }

  setView(v: View): void {
    this.view = clampView(v, this.limits);
    this.applyView();
  }

  private applyView(): void {
    const f = frustum(this.view, this.aspect);
    this.camera.left = f.left;
    this.camera.right = f.right;
    this.camera.top = f.top;
    this.camera.bottom = f.bottom;
    this.camera.position.x = this.view.cx;
    this.camera.position.z = this.view.cz;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
