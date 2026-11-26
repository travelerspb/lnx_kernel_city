import { describe, expect, it, vi } from 'vitest';
import { Bus } from './bus';

type Ev = { ping: number };

describe('Bus', () => {
  it('delivers, unsubscribes and fires once handlers once', () => {
    const bus = new Bus<Ev>();
    const a: number[] = [];
    const off = bus.on('ping', (n) => a.push(n));
    bus.once('ping', (n) => a.push(n * 10));
    bus.emit('ping', 1);
    off();
    bus.emit('ping', 2);
    expect(a).toEqual([1, 10]);
  });

  it('keeps calling handlers after one throws', () => {
    const bus = new Bus<Ev>();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const got: number[] = [];
    bus.on('ping', () => {
      throw new Error('boom');
    });
    bus.on('ping', (n) => got.push(n));
    bus.emit('ping', 3);
    expect(got).toEqual([3]);
    expect(err).toHaveBeenCalledOnce();
    err.mockRestore();
  });
});
