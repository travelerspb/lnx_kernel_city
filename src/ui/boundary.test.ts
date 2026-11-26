// WP4 acceptance: no module under src/ui imports three or src/world, src/engine.
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findForbiddenImports, listTs } from '../../test/helpers/imports';

const ROOT = resolve(__dirname, '../..');

describe('ui boundary', () => {
  it('src/ui imports neither three nor world or engine', () => {
    const entries = listTs(join(ROOT, 'src/ui'));
    expect(entries.length).toBeGreaterThan(0);
    expect(findForbiddenImports(ROOT, entries, /^three(\/|$)/, ['src/world', 'src/engine'])).toEqual([]);
  });
});
