// Typed event bus. A handler that throws is logged and does not stop the
// other handlers.

import type { BusEvents } from './types';

type Handler<T> = (payload: T) => void;

export class Bus<Events extends object = BusEvents> {
  private handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(name: K, fn: Handler<Events[K]>): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(fn as Handler<never>);
    return () => this.off(name, fn);
  }

  off<K extends keyof Events>(name: K, fn: Handler<Events[K]>): void {
    this.handlers.get(name)?.delete(fn as Handler<never>);
  }

  once<K extends keyof Events>(name: K, fn: Handler<Events[K]>): () => void {
    const wrapper: Handler<Events[K]> = (p) => {
      this.off(name, wrapper);
      fn(p);
    };
    return this.on(name, wrapper);
  }

  emit<K extends keyof Events>(name: K, payload: Events[K]): void {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as Handler<Events[K]>)(payload);
      } catch (err) {
        console.error(`bus handler for '${String(name)}' threw`, err);
      }
    }
  }
}
