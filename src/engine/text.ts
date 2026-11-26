// Text labels as sprites with a canvas texture. Sprites face the camera, and
// the camera looks straight down with north up, so text always reads upright.

import { CanvasTexture, SRGBColorSpace, Sprite, SpriteMaterial } from 'three';

export interface LabelStyle {
  /** Text height in world units. */
  size: number;
  colour: string;
  bold?: boolean;
  /** 'left' anchors the sprite at its west edge. */
  align?: 'left' | 'centre';
}

const PX = 64;

export class Label {
  readonly sprite: Sprite;
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: CanvasTexture;
  private text = '';
  private style: LabelStyle;

  constructor(text: string, style: LabelStyle) {
    this.canvas = document.createElement('canvas');
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    const mat = new SpriteMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false });
    this.sprite = new Sprite(mat);
    this.sprite.renderOrder = 10;
    this.style = style;
    if (style.align === 'left') this.sprite.center.set(0, 0.5);
    this.set(text, style.colour);
  }

  set(text: string, colour = this.style.colour): void {
    if (text === this.text && colour === this.style.colour && this.canvas.width > 0) return;
    this.text = text;
    this.style = { ...this.style, colour };
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const font = `${this.style.bold ? '600 ' : ''}${PX}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.font = font;
    // '\n' starts a new line; the sprite grows downwards from the first.
    const lines = text.split('\n');
    const w = Math.max(1, Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + 8);
    const lineH = Math.ceil(PX * 1.3);
    const h = lineH * lines.length;
    this.canvas.width = w;
    this.canvas.height = h;
    ctx.font = font;
    ctx.fillStyle = colour;
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, 4, lineH * (i + 0.5)));
    this.texture.needsUpdate = true;
    const worldLineH = this.style.size * 1.3;
    this.sprite.scale.set((worldLineH * w) / lineH, worldLineH * lines.length, 1);
    // Keep the first line where a one-line label would be.
    this.sprite.center.y = 1 - 0.5 / lines.length;
  }

  setColour(colour: string): void {
    this.set(this.text, colour);
  }

  dispose(): void {
    this.texture.dispose();
    this.sprite.material.dispose();
  }
}
