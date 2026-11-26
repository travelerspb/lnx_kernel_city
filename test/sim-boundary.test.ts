// ARCHITECTURE.md rules 2 and 5: the sim and the reducer never reach three.js,
// the world, the engine or the UI, and never read a clock or Math.random.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findForbiddenImports, listTs } from './helpers/imports';

const ROOT = resolve(__dirname, '..');
const THREE = /^three(\/|$)/;
const FORBIDDEN_DIRS = ['src/world', 'src/engine', 'src/ui'];

const entries = () => [
  ...listTs(join(ROOT, 'src/sim')),
  ...listTs(join(ROOT, 'src/core')),
];

describe('sim boundary', () => {
  it('src/sim and src/core import neither three nor world, engine, ui', () => {
    expect(findForbiddenImports(ROOT, entries(), THREE, FORBIDDEN_DIRS)).toEqual([]);
  });

  it('src/sim and core/apply.ts use no wall clock and no Math.random', () => {
    const files = [...listTs(join(ROOT, 'src/sim')), join(ROOT, 'src/core/apply.ts')];
    const bad = files.filter((f) => /Math\.random|Date\.now|performance\.now/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });

  it('the checker catches a sim file that imports three or the world', () => {
    const root = mkdtempSync(join(tmpdir(), 'lkc-boundary-'));
    mkdirSync(join(root, 'src/sim'), { recursive: true });
    mkdirSync(join(root, 'src/world'), { recursive: true });
    writeFileSync(join(root, 'src/sim/model.ts'), "import { helper } from './helper';\n");
    writeFileSync(join(root, 'src/sim/helper.ts'), "import * as THREE from 'three';\nimport { a } from '../world/layout';\n");
    writeFileSync(join(root, 'src/world/layout.ts'), 'export const a = 1;\n');
    const v = findForbiddenImports(root, listTs(join(root, 'src/sim')), THREE, FORBIDDEN_DIRS);
    expect(v).toEqual(
      expect.arrayContaining([
        { file: 'src/sim/helper.ts', spec: 'three' },
        { file: 'src/sim/helper.ts', spec: '../world/layout' },
      ]),
    );
  });
});
