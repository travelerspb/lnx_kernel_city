// Interrupt dispatch: kernel/irq and kernel/softirq.c. The handler plate
// takes the hardirq or softirq colour, and a frame, while some CPU runs it.

import type { Mesh } from 'three';
import type { WorldCtx } from '../context';
import { DISTRICTS, LAYERS, STATION_LABELS, SIZES, stationPoint } from '../layout';
import type { Role } from '../palette';
import { plot, type District } from './district';
import type { Group } from 'three';

export function create(ctx: WorldCtx): District {
  plot(ctx, 'interrupts');
  const irq = ctx.pad('irq', STATION_LABELS['irq']!);
  const soft = ctx.pad('softirq', STATION_LABELS['softirq']!);
  const ring = (station: 'irq' | 'softirq', role: Role): Group => {
    const p = stationPoint(station);
    const s = SIZES.stationPad + 0.6;
    const g = ctx.frame({ minX: p.x - s, maxX: p.x + s, minZ: p.z - s, maxZ: p.z + s }, role, 0.35, LAYERS.pad + 0.001);
    g.visible = false;
    return g;
  };
  const irqRing = ring('irq', 'cpu.hardirq');
  const softRing = ring('softirq', 'cpu.softirq');
  const setActive = (pad: Mesh, frame: Group, active: boolean, role: Role) => {
    pad.material = ctx.mats.get(active ? role : 'pad');
    frame.visible = active;
  };
  return {
    update(state) {
      const hard = state.cpus.some((c) => c.context === 'hardirq');
      const sft = state.cpus.some((c) => c.context === 'softirq');
      setActive(irq.pad, irqRing, hard, 'cpu.hardirq');
      setActive(soft.pad, softRing, sft, 'cpu.softirq');
    },
  };
}
