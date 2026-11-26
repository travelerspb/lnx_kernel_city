// Transport logic without DOM: what the controls show, which command a key
// or button sends, and the logarithmic speed slider.

import type { PresentationMode, TransportCommand } from '../core/types';
import { formatNs } from './format';

/** The part of PresentationClock the UI reads. It never writes to it. */
export interface ClockView {
  readonly mode: PresentationMode;
  readonly playing: boolean;
  readonly skippedNs: number;
  readonly pacing: { readonly nsPerMs: number };
}

export interface TransportView {
  mode: PresentationMode;
  playing: boolean;
  ended: boolean;
  /** Play is pointless in step mode. At the end of the stream it replays. */
  canPlay: boolean;
  canStep: boolean;
  /** The slider only drives time-true mode. */
  speedEnabled: boolean;
  nsPerMs: number;
  speedText: string;
  playLabel: 'Play' | 'Pause';
}

export function transportView(clock: ClockView, ended: boolean): TransportView {
  const playing = clock.playing && !ended;
  return {
    mode: clock.mode,
    playing,
    ended,
    canPlay: clock.mode !== 'step',
    canStep: !ended,
    speedEnabled: clock.mode === 'time',
    nsPerMs: clock.pacing.nsPerMs,
    speedText: speedText(clock.pacing.nsPerMs),
    playLabel: playing ? 'Pause' : 'Play',
  };
}

/** Command for the play/pause toggle. */
export function toggleCommand(clock: ClockView): TransportCommand {
  return clock.playing ? { action: 'pause' } : { action: 'play' };
}

// Slider 0..SLIDER_MAX maps to 10^SPEED_MIN_EXP .. 10^SPEED_MAX_EXP sim ns
// per wall ms: from 1 ns per ms (1 µs of sim time per wall second) to
// 1 ms per ms (real time).
export const SLIDER_MAX = 600;
export const SPEED_MIN_EXP = 0;
export const SPEED_MAX_EXP = 6;

export function sliderToNsPerMs(pos: number): number {
  const p = Math.min(SLIDER_MAX, Math.max(0, pos)) / SLIDER_MAX;
  const v = 10 ** (SPEED_MIN_EXP + p * (SPEED_MAX_EXP - SPEED_MIN_EXP));
  // Keep 1-2-5 style values exact at decade boundaries.
  return Number(v.toPrecision(3));
}

export function nsPerMsToSlider(nsPerMs: number): number {
  const e = Math.log10(Math.max(10 ** SPEED_MIN_EXP, Math.min(10 ** SPEED_MAX_EXP, nsPerMs)));
  return Math.round(((e - SPEED_MIN_EXP) / (SPEED_MAX_EXP - SPEED_MIN_EXP)) * SLIDER_MAX);
}

/** "1.000 ms of sim time per wall second". */
export function speedText(nsPerMs: number): string {
  return `${formatNs(nsPerMs * 1000)} per second`;
}

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** Tag name of the event target, upper case as in the DOM. */
  targetTag?: string;
  /** `type` attribute of an INPUT target, lower case. */
  targetType?: string;
  targetEditable?: boolean;
}

const TYPING_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);
/** Inputs where space and arrows mean nothing worth keeping: shortcuts win. */
const SHORTCUT_INPUTS = new Set(['radio', 'checkbox', 'button']);

function isTyping(k: KeyLike): boolean {
  if (k.targetEditable) return true;
  if (k.targetTag === undefined || !TYPING_TAGS.has(k.targetTag)) return false;
  return !(k.targetTag === 'INPUT' && k.targetType !== undefined && SHORTCUT_INPUTS.has(k.targetType));
}

/**
 * Keyboard shortcuts: space plays or pauses, right arrow steps, r resets.
 * Returns null when the key is not a shortcut, or when the target is a text
 * field, a select or a range slider, which use these keys themselves.
 */
export function keyCommand(k: KeyLike, clock: ClockView): TransportCommand | null {
  if (k.ctrlKey || k.metaKey || k.altKey) return null;
  if (isTyping(k)) return null;
  switch (k.key) {
    case ' ':
    case 'Spacebar':
      return toggleCommand(clock);
    case 'ArrowRight':
      return { action: 'step' };
    case 'r':
    case 'R':
      return { action: 'reset' };
    default:
      return null;
  }
}

export const MODES: ReadonlyArray<{ mode: PresentationMode; label: string; hint: string }> = [
  { mode: 'event', label: 'Event-paced', hint: 'Each event stays on screen; idle gaps are compressed' },
  { mode: 'time', label: 'Time-true', hint: 'Sim time runs linearly at the chosen speed' },
  { mode: 'step', label: 'Step', hint: 'Advance one event at a time' },
];
