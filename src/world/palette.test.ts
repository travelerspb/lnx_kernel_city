import { describe, expect, it } from 'vitest';
import { LOOKS, PALETTE, contrast, type LookId, type Role, type Theme } from './palette';

const THEMES: Theme[] = ['light', 'dark'];

/** One entry per row of the CITY_MAP colour table. */
const CITY_MAP_ROWS: Record<string, LookId[]> = {
  'User mode': ['task.user'],
  'Kernel mode, process context': ['task.kernel'],
  'Hardirq context': ['cpu.hardirq'],
  'Softirq context': ['cpu.softirq'],
  'Runnable, waiting for a CPU': ['task.user.runnable', 'task.kernel.runnable'],
  Sleeping: ['task.user.sleeping', 'task.kernel.sleeping'],
  'Page absent, locked for I/O, up to date': ['page.absent', 'page.locked', 'page.uptodate'],
  'I/O in flight': ['request.in_device'],
};

const GROUPS: Record<string, LookId[]> = {
  task: (Object.keys(LOOKS) as LookId[]).filter((k) => k.startsWith('task.')),
  cpu: (Object.keys(LOOKS) as LookId[]).filter((k) => k.startsWith('cpu.')),
  page: ['page.absent', 'page.locked', 'page.uptodate'],
  request: (Object.keys(LOOKS) as LookId[]).filter((k) => k.startsWith('request.')),
};

const backgroundsFor: Record<string, Role[]> = {
  task: ['zone.userland', 'zone.kernel', 'district'],
  cpu: ['zone.kernel', 'district', 'lane'],
  page: ['district'],
  request: ['district', 'zone.hardware'],
};

describe('colour and shape table', () => {
  it('covers every row of the CITY_MAP colour table', () => {
    for (const ids of Object.values(CITY_MAP_ROWS)) for (const id of ids) expect(LOOKS[id]).toBeDefined();
  });

  it('defines every role in both themes', () => {
    const roles = Object.keys(PALETTE.light) as Role[];
    expect(Object.keys(PALETTE.dark).sort()).toEqual([...roles].sort());
    for (const t of THEMES) for (const r of roles) expect(PALETTE[t][r]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('every state in a group differs by shape or glyph, not only colour', () => {
    for (const ids of Object.values(GROUPS)) {
      const forms = ids.map((id) => `${LOOKS[id].shape}/${LOOKS[id].hollow}/${LOOKS[id].glyph}`);
      expect(new Set(forms).size).toBe(ids.length);
    }
  });

  it('state colours in a group are distinct and readable in both themes', () => {
    for (const t of THEMES) {
      for (const [g, ids] of Object.entries(GROUPS)) {
        const roles = [...new Set(ids.map((id) => LOOKS[id].role))];
        const hexes = roles.map((r) => PALETTE[t][r]);
        expect(new Set(hexes).size).toBe(roles.length);
        for (const r of roles) {
          for (const bg of backgroundsFor[g]!) {
            const c = contrast(PALETTE[t][r], PALETTE[t][bg]);
            expect(c, `${t} ${r} on ${bg}: ${c.toFixed(2)}`).toBeGreaterThanOrEqual(3);
          }
        }
      }
    }
  });

  it('text is readable on every ground', () => {
    for (const t of THEMES) {
      for (const bg of ['ground', 'zone.userland', 'zone.kernel', 'zone.hardware', 'district', 'lot'] as Role[]) {
        expect(contrast(PALETTE[t].text, PALETTE[t][bg])).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
