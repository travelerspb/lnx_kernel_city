import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;

export function listTs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listTs(p));
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

function resolveLocal(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

export interface Violation {
  file: string;
  spec: string;
}

/**
 * Walk the import graph from `entries` and report every import of a bare
 * package matching `forbiddenPackages` or of a file under one of
 * `forbiddenDirs`. Paths in the result are relative to `root`.
 */
export function findForbiddenImports(
  root: string,
  entries: string[],
  forbiddenPackages: RegExp,
  forbiddenDirs: string[],
): Violation[] {
  const seen = new Set<string>();
  const queue = [...entries];
  const out: Violation[] = [];
  const dirs = forbiddenDirs.map((d) => resolve(root, d) + '/');
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2] ?? m[3]!;
      if (spec.startsWith('.')) {
        const target = resolveLocal(file, spec);
        if (!target) continue;
        if (dirs.some((d) => target.startsWith(d))) out.push({ file: relative(root, file), spec });
        else queue.push(target);
      } else if (forbiddenPackages.test(spec)) {
        out.push({ file: relative(root, file), spec });
      }
    }
  }
  return out;
}
