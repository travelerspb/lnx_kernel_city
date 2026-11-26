import { describe, expect, it } from 'vitest';
import { DEFAULT_PACING, PresentationClock, pacedDwell } from './timebase';

describe('pacedDwell', () => {
  it('gives every event at least the minimum dwell', () => {
    expect(pacedDwell(100).ms).toBe(DEFAULT_PACING.minDwellMs);
  });

  it('compresses long idle gaps and reports the skipped sim time', () => {
    const gap = 10_000_000; // 10 ms
    const d = pacedDwell(gap);
    expect(d.ms).toBe(DEFAULT_PACING.maxGapMs);
    expect(d.skippedNs).toBe(gap - DEFAULT_PACING.maxGapMs / DEFAULT_PACING.msPerNs);
  });
});

describe('PresentationClock', () => {
  it('does not advance while paused', () => {
    const c = new PresentationClock();
    expect(c.advance(10_000, 500, 0)).toBe(0);
  });

  it('releases one event per dwell in event-paced mode', () => {
    const c = new PresentationClock();
    c.play();
    expect(c.advance(100, 1000, 0)).toBe(0);
    expect(c.advance(300, 1000, 0)).toBe(1000);
  });

  it('steps exactly one event on request, even when paused', () => {
    const c = new PresentationClock();
    c.setMode('step');
    expect(c.advance(16, 1000, 0)).toBe(0);
    c.requestStep();
    expect(c.advance(16, 1000, 0)).toBe(1000);
    expect(c.advance(16, 2000, 1000)).toBe(1000);
  });

  it('maps wall time linearly in time-true mode', () => {
    const c = new PresentationClock();
    c.setMode('time');
    c.setSpeed(1000);
    c.play();
    expect(c.advance(10, 1_000_000, 0)).toBe(10_000);
    expect(c.advance(10, 1_000_000, 5_000)).toBe(20_000);
  });

  it('returns now at the end of the stream', () => {
    const c = new PresentationClock();
    c.play();
    expect(c.advance(10_000, null, 42)).toBe(42);
  });

  it('ignores play in step mode', () => {
    const c = new PresentationClock();
    c.setMode('step');
    c.play();
    expect(c.playing).toBe(false);
  });

  it('releases one event per step and per event-paced dwell, even on a timestamp tie', () => {
    const c = new PresentationClock();
    c.requestStep();
    c.advance(16, 1000, 0);
    expect(c.limit).toBe(1);
    c.play();
    c.advance(10_000, 1000, 1000);
    expect(c.limit).toBe(1);
    c.setMode('time');
    c.advance(16, 5000, 1000);
    expect(c.limit).toBe(Infinity);
  });
});
