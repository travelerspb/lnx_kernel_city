import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../test/helpers/fixture';
import { Bus } from '../core/bus';
import { FixtureSource } from '../core/fixtureSource';
import { Runtime } from '../core/runtime';
import { inspectorView } from './inspectorModel';
import { LogModel } from './logModel';

function setup() {
  const bus = new Bus();
  const log = new LogModel();
  bus.on('kevent', ({ event, state }) => log.push(event, state));
  const rt = new Runtime(new FixtureSource(loadFixture()), bus);
  return { log, rt };
}

const field = (v: ReturnType<typeof inspectorView>, label: string) => v.fields.find((f) => f.label === label)?.value;

describe('inspectorView', () => {
  it('shows a hint when nothing is selected', () => {
    const { log, rt } = setup();
    expect(inspectorView(null, rt.state, log).title).toBe('Nothing selected');
  });

  it('shows a task from state', () => {
    const { log, rt } = setup();
    rt.runUntil(4000); // reader is asleep waiting for I/O
    const v = inspectorView({ kind: 'task', pid: 100 }, rt.state, log);
    expect(v.title).toBe('reader (pid 100)');
    expect(field(v, 'state')).toMatch(/^sleeping/);
    expect(v.fields.some((f) => f.label === 'flow' && f.select?.kind === 'flow')).toBe(true);
    expect(inspectorView({ kind: 'task', pid: 4242 }, rt.state, log).note).toMatch(/No such task/);
  });

  it('shows an event from the log with its payload and evidence marker', () => {
    const { log, rt } = setup();
    rt.runUntil(2000);
    const v = inspectorView({ kind: 'event', seq: 5 }, rt.state, log);
    expect(v.title).toBe('page_cache_lookup #5');
    expect(field(v, 'hit')).toBe('false');
    expect(field(v, 'tier')).toBe('P: Function probe');
    expect(field(v, 'evidence')).toBe('no evidence entry');
    expect(inspectorView({ kind: 'event', seq: 999 }, rt.state, log).note).toMatch(/no longer/);
  });

  it('shows an open flow from state and a finished one from the log', () => {
    const { log, rt } = setup();
    rt.runUntil(2000);
    const open = inspectorView({ kind: 'flow', flow: 1 }, rt.state, log);
    expect(field(open, 'name')).toBe('read');
    expect(open.note).toBeUndefined();
    rt.runToEnd();
    const done = inspectorView({ kind: 'flow', flow: 1 }, rt.state, log);
    expect(done.note).toMatch(/finished/);
    expect(field(done, 'duration')).toMatch(/µs|ms/);
  });

  it('shows a CPU station and the page cache', () => {
    const { log, rt } = setup();
    rt.runToEnd();
    const cpu = inspectorView({ kind: 'station', station: 'cpu:1' }, rt.state, log);
    expect(field(cpu, 'current')).toBeDefined();
    const pc = inspectorView({ kind: 'station', station: 'page_cache' }, rt.state, log);
    expect(field(pc, 'page 12:0')).toBe('uptodate');
  });
});

describe('inspectorView with the glossary', () => {
  const file = loadFixture();
  const rt = new Runtime(new FixtureSource(file));
  rt.runToEnd();
  const log = new LogModel(null, 'evidence/');

  it('explains each scenario task by its role', () => {
    const r = inspectorView({ kind: 'task', pid: 100 }, rt.state, log).about?.summary;
    const a = inspectorView({ kind: 'task', pid: 101 }, rt.state, log).about?.summary;
    const b = inspectorView({ kind: 'task', pid: 102 }, rt.state, log).about?.summary;
    expect(r).toMatch(/reads one small file/);
    expect(a).toMatch(/only computes/);
    expect(new Set([r, a, b]).size).toBe(3);
  });

  it('explains a zone and lists the user tasks in it', () => {
    const v = inspectorView({ kind: 'zone', zone: 'userland' }, rt.state, log);
    expect(v.title).toBe('User Code');
    expect(v.about?.summary).toMatch(/user space/);
    expect(v.fields.map((f) => f.value)).toContain('reader(100)');
  });

  it('explains a later-stage district and says which stage builds it', () => {
    const v = inspectorView({ kind: 'district', district: 'memory' }, rt.state, log);
    expect(v.subtitle).toBe('district, stage 3');
    expect(v.about?.stage).toBe(3);
  });

  it('gives a station its title, evidence links and related entries', () => {
    const v = inspectorView({ kind: 'station', station: 'page_cache' }, rt.state, log);
    expect(v.title).toBe('Page cache lookup');
    expect(v.about?.evidence[0]?.href).toMatch(/^evidence\/read-path\.md#/);
    expect(v.about?.related).toContainEqual({ label: 'Page cache warehouse', select: { kind: 'district', district: 'page_cache' } });
  });

  it('titles per-CPU stations with the CPU and links the context to its meaning', () => {
    const v = inspectorView({ kind: 'station', station: 'cpu:1' }, rt.state, log);
    expect(v.title).toBe('CPU core 1');
    expect(v.fields.find((f) => f.label === 'context')?.select).toEqual({ kind: 'info', id: 'cpu-context:user' });
  });

  it('shows a concept that is not on the map', () => {
    const v = inspectorView({ kind: 'info', id: 'cpu-context:hardirq' }, rt.state, log);
    expect(v.title).toBe('Hardirq');
    expect(v.subtitle).toBe('cpu context');
  });

  it('adds the meaning of a task state and the task kind', () => {
    const v = inspectorView({ kind: 'task', pid: 100 }, rt.state, log);
    expect(v.fields.find((f) => f.label === 'state means')?.value).toMatch(/^Running/);
    // The task's own role comes first; the generic kind is one link away.
    expect(v.about?.related.map((r) => r.label)).toContain('User task');
  });
});
