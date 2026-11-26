import { describe, expect, it } from 'vitest';
import { PresentationClock } from '../core/timebase';
import { keyCommand, nsPerMsToSlider, SLIDER_MAX, sliderToNsPerMs, speedText, toggleCommand, transportView } from './transport';

describe('transport', () => {
  it('the slider is logarithmic and round-trips', () => {
    expect(sliderToNsPerMs(0)).toBe(1);
    expect(sliderToNsPerMs(SLIDER_MAX)).toBe(1_000_000);
    expect(sliderToNsPerMs(SLIDER_MAX / 2)).toBe(1000);
    for (const v of [1, 10, 1000, 31_600, 1_000_000]) expect(sliderToNsPerMs(nsPerMsToSlider(v))).toBeCloseTo(v, -Math.log10(v) + 2);
    expect(nsPerMsToSlider(1e12)).toBe(SLIDER_MAX);
  });

  it('describes speed as sim time per wall second', () => {
    expect(speedText(1000)).toBe('1.000 ms per second');
    expect(speedText(1)).toBe('1.000 µs per second');
  });

  it('derives the view from the clock', () => {
    const c = new PresentationClock();
    let v = transportView(c, false);
    expect(v).toMatchObject({ mode: 'event', playing: false, playLabel: 'Play', canPlay: true, canStep: true, speedEnabled: false });
    c.play();
    c.setMode('time');
    v = transportView(c, false);
    expect(v).toMatchObject({ playing: true, playLabel: 'Pause', speedEnabled: true });
    expect(transportView(c, true)).toMatchObject({ playing: false, canPlay: true, canStep: false });
    c.setMode('step');
    expect(transportView(c, false).canPlay).toBe(false);
  });

  it('toggles play and pause', () => {
    const c = new PresentationClock();
    expect(toggleCommand(c)).toEqual({ action: 'play' });
    c.play();
    expect(toggleCommand(c)).toEqual({ action: 'pause' });
  });

  it('maps keys to commands, not while typing', () => {
    const c = new PresentationClock();
    expect(keyCommand({ key: ' ' }, c)).toEqual({ action: 'play' });
    expect(keyCommand({ key: 'ArrowRight' }, c)).toEqual({ action: 'step' });
    expect(keyCommand({ key: 'r' }, c)).toEqual({ action: 'reset' });
    expect(keyCommand({ key: 'x' }, c)).toBeNull();
    expect(keyCommand({ key: 'r', metaKey: true }, c)).toBeNull();
    expect(keyCommand({ key: ' ', targetTag: 'INPUT', targetType: 'text' }, c)).toBeNull();
    expect(keyCommand({ key: 'ArrowRight', targetTag: 'INPUT', targetType: 'range' }, c)).toBeNull();
    expect(keyCommand({ key: ' ', targetTag: 'SELECT' }, c)).toBeNull();
    expect(keyCommand({ key: ' ', targetTag: 'DIV', targetEditable: true }, c)).toBeNull();
    expect(keyCommand({ key: ' ', targetTag: 'INPUT', targetType: 'radio' }, c)).toEqual({ action: 'play' });
    expect(keyCommand({ key: ' ', targetTag: 'BUTTON' }, c)).toEqual({ action: 'play' });
  });
});
