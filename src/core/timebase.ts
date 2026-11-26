// Two clocks (ARCHITECTURE.md, time model).
//
// The sim clock is KernelState.now, in ns. It is the truth.
// The presentation clock decides how far the runtime may advance for a given
// amount of wall time. It never touches state; main.ts asks it for a target
// and calls runtime.runUntil(target).

import type { PresentationMode } from './types';

export interface PacingOptions {
  /** Event-paced: minimum wall time each event stays on screen. */
  minDwellMs: number;
  /** Event-paced: longest wall time an idle gap may take. */
  maxGapMs: number;
  /** Event-paced: wall ms per sim ns for gaps that fit under maxGapMs. */
  msPerNs: number;
  /** Time-true: sim ns per wall ms. */
  nsPerMs: number;
}

export const DEFAULT_PACING: PacingOptions = {
  minDwellMs: 350,
  maxGapMs: 1500,
  msPerNs: 1 / 200, // 1 µs of sim time takes 5 ms on screen
  nsPerMs: 1_000, // time-true: 1 µs of sim time per ms
};

/** Event-paced wall time for a sim gap, and the sim time that is skipped. */
export function pacedDwell(gapNs: number, o: PacingOptions = DEFAULT_PACING): { ms: number; skippedNs: number } {
  const linear = gapNs * o.msPerNs;
  const ms = Math.min(o.maxGapMs, Math.max(o.minDwellMs, linear));
  const skippedNs = linear > o.maxGapMs ? gapNs - o.maxGapMs / o.msPerNs : 0;
  return { ms, skippedNs };
}

export class PresentationClock {
  mode: PresentationMode = 'event';
  playing = false;
  /** Total sim time compressed away by event pacing, shown in the HUD. */
  skippedNs = 0;
  private waitedMs = 0;
  private timeTarget = 0;
  private stepRequested = false;
  /** How many events the last advance() released: 1 for a step or an
   *  event-paced release, even when several events share a timestamp. */
  limit = Infinity;

  constructor(public pacing: PacingOptions = { ...DEFAULT_PACING }) {}

  /** No effect in step mode, which only advances on requestStep(). */
  play(): void {
    if (this.mode !== 'step') this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  /** In any mode: release exactly one more event on the next advance(). */
  requestStep(): void {
    this.stepRequested = true;
  }

  setMode(mode: PresentationMode): void {
    this.mode = mode;
    this.waitedMs = 0;
    if (mode === 'step') this.playing = false;
  }

  /** Time-true speed, sim ns per wall ms. The UI maps a log slider to it. */
  setSpeed(nsPerMs: number): void {
    this.pacing.nsPerMs = Math.max(1, nsPerMs);
  }

  reset(): void {
    this.skippedNs = 0;
    this.waitedMs = 0;
    this.timeTarget = 0;
    this.stepRequested = false;
  }

  /**
   * Advance by wall time and return the sim time up to which events may be
   * applied. `nextTs` is the next event's timestamp (null at end), `now` the
   * sim time of the last applied event.
   */
  advance(wallDtMs: number, nextTs: number | null, now: number): number {
    this.limit = 1;
    if (nextTs === null) return now;
    if (this.stepRequested) {
      this.stepRequested = false;
      this.waitedMs = 0;
      this.timeTarget = nextTs;
      return nextTs;
    }
    if (!this.playing || this.mode === 'step') return now;
    if (this.mode === 'time') {
      this.limit = Infinity;
      this.timeTarget = Math.max(this.timeTarget, now) + wallDtMs * this.pacing.nsPerMs;
      return this.timeTarget;
    }
    // Event-paced: one event per dwell.
    this.waitedMs += wallDtMs;
    const { ms, skippedNs } = pacedDwell(nextTs - now, this.pacing);
    if (this.waitedMs < ms) return now;
    this.waitedMs -= ms;
    this.skippedNs += skippedNs;
    this.timeTarget = nextTs;
    return nextTs;
  }

  /** Fraction 0..1 of the wait before the next event, for smooth motion. */
  progress(nextTs: number | null, now: number): number {
    if (nextTs === null || this.mode !== 'event') return 0;
    const { ms } = pacedDwell(nextTs - now, this.pacing);
    return Math.min(1, this.waitedMs / ms);
  }
}
