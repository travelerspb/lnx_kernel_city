import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGEND, legendSignatures } from './legend';

const css = readFileSync(resolve(__dirname, '../styles/ui.css'), 'utf8');

describe('legend', () => {
  it('never tells two meanings apart by colour alone', () => {
    const sigs = legendSignatures();
    expect(new Set(sigs).size).toBe(sigs.length);
  });

  it('every colour token is defined for light, dark media and forced dark', () => {
    const blocks = [
      /:root \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '',
      /:root:not\(\[data-theme='light'\]\) \{([\s\S]*?)\n  \}/.exec(css)?.[1] ?? '',
      /:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '',
    ];
    const tokens = new Set([...LEGEND.flatMap((g) => g.items.map((i) => i.token)), 'lkc-glyph', 'lkc-tier-T', 'lkc-tier-P', 'lkc-tier-S']);
    for (const b of blocks) {
      expect(b.length).toBeGreaterThan(0);
      for (const t of tokens) expect(b, t).toMatch(new RegExp(`--${t}:\\s*#[0-9a-f]{6};`));
    }
  });
});
