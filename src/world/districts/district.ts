// The shape every district module has: create(ctx) builds its static parts
// and returns update(), called once per frame with the current state.

import type { KernelState } from '../../core/types';
import type { WorldCtx } from '../context';
import { DISTRICTS, LAYERS, SIZES, labelPoint, type DistrictId } from '../layout';
import type { WorldView } from '../view';

export interface District {
  /** Read state, change looks. Never writes state. `t` is wall ms since start. */
  update(state: Readonly<KernelState>, view: WorldView, t: number): void;
}

export type CreateDistrict = (ctx: WorldCtx) => District;

export const STATIC: District = { update() {} };

/** A district plot: built districts are filled with a solid border, later
 *  stages are empty lots with a thin border and a stage note. */
export function plot(ctx: WorldCtx, id: DistrictId): void {
  const b = DISTRICTS[id];
  const built = b.stage <= 1;
  const ground = ctx.rect(b, built ? 'district' : 'lot', LAYERS.district);
  ctx.pickable(ground, { kind: 'district', district: id });
  ctx.frame(b, built ? 'district.border' : 'lot.border', built ? 0.35 : 0.2, LAYERS.district + 0.001);
  const text = built ? b.label : `${b.label}\nstage ${b.stage}`;
  ctx.label(text, labelPoint(b), {
    size: built ? SIZES.label : SIZES.smallLabel,
    role: built ? 'text' : 'text.muted',
    bold: built,
    align: 'left',
  });
}
