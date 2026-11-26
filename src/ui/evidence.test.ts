import { describe, expect, it } from 'vitest';
import type { KEvent } from '../core/types';
import { loadEvidenceIndex, parseEvidenceIndex, resolveEvidence, type EvidenceIndex } from './evidence';

const index: EvidenceIndex = {
  kernel: 'v6.18',
  events: {
    func_entry: { file: 'read-path.md', anchor: 'function-probes', status: 'verified' },
    sys_enter: { file: 'read-path.md', anchor: 'sys-enter', status: 'verified' },
    hw_io_start: { file: 'block.md', anchor: 'device', status: 'not-verified' },
  },
  functions: {
    vfs_read: { file: 'read-path.md', anchor: 'vfs-read', status: 'verified' },
  },
};

const base = { seq: 0, ts: 0, cpu: 0, pid: 100, tier: 'P' } as const;

describe('resolveEvidence', () => {
  it('prefers the function entry for function probes', () => {
    const ev: KEvent = { ...base, type: 'func_entry', fn: 'vfs_read' };
    expect(resolveEvidence(index, ev, 'evidence/')).toEqual({
      href: 'evidence/read-path.md#vfs-read',
      label: 'read-path.md#vfs-read',
      status: 'verified',
      via: 'function',
    });
  });

  it('falls back to the event type entry', () => {
    const ev: KEvent = { ...base, type: 'func_entry', fn: 'unknown_fn' };
    expect(resolveEvidence(index, ev, 'evidence')?.href).toBe('evidence/read-path.md#function-probes');
    expect(resolveEvidence(index, ev, 'evidence')?.via).toBe('event');
  });

  it('keeps the status and accepts an absolute base', () => {
    const ev: KEvent = { ...base, tier: 'S', type: 'hw_io_start', dev: 'vda', sector: 1 };
    const link = resolveEvidence(index, ev, 'https://example.org/repo/blob/main/evidence/');
    expect(link?.href).toBe('https://example.org/repo/blob/main/evidence/block.md#device');
    expect(link?.status).toBe('not-verified');
  });

  it('returns null without an index or without an entry', () => {
    const ev: KEvent = { ...base, type: 'copy_to_user', bytes: 1 };
    expect(resolveEvidence(null, ev, 'evidence/')).toBeNull();
    expect(resolveEvidence(index, ev, 'evidence/')).toBeNull();
  });

  it('ignores inherited object keys', () => {
    const ev: KEvent = { ...base, type: 'func_entry', fn: 'constructor' };
    expect(resolveEvidence({ ...index, events: {} }, ev, '')).toBeNull();
  });
});

describe('parseEvidenceIndex and loadEvidenceIndex', () => {
  it('drops malformed entries', () => {
    const parsed = parseEvidenceIndex({
      kernel: 'v6.18',
      events: { sys_enter: { file: 'a.md', anchor: 'x', status: 'verified' }, bad: { file: 1 }, worse: { file: 'a.md', anchor: 'x', status: 'maybe' } },
    });
    expect(Object.keys(parsed?.events ?? {})).toEqual(['sys_enter']);
    expect(parsed?.functions).toEqual({});
    expect(parseEvidenceIndex('nope')).toBeNull();
  });

  it('resolves to null when the file is missing or the fetch throws', async () => {
    expect(await loadEvidenceIndex('x', async () => ({ ok: false, json: async () => ({}) }))).toBeNull();
    expect(await loadEvidenceIndex('x', async () => { throw new Error('offline'); })).toBeNull();
    const ok = await loadEvidenceIndex('x', async () => ({ ok: true, json: async () => index }));
    expect(ok?.functions['vfs_read']?.anchor).toBe('vfs-read');
  });
});

describe('the real evidence index, when WP1 has landed', () => {
  it('links every fixture event', async () => {
    const { existsSync, readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const { loadFixture } = await import('../../test/helpers/fixture');
    const path = resolve(__dirname, '../../evidence/index.json');
    if (!existsSync(path)) return;
    const idx = parseEvidenceIndex(JSON.parse(readFileSync(path, 'utf8')));
    const missing = loadFixture().events.filter((ev) => resolveEvidence(idx, ev, 'evidence/') === null).map((ev) => ev.type);
    expect(missing).toEqual([]);
  });
});
