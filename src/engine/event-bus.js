'use strict';

/**
 * Minimal synchronous event bus for decoupled subsystem communication.
 * Engine components (orchestrator, corrector, memory) emit and listen here
 * instead of importing each other directly. Inspired by OpenHands' typed event
 * system, but kept dependency-free for the local/low-resource target.
 */
class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    const set = this.listeners.get(event);
    if (set) set.delete(handler);
  }

  emit(event, payload) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch (err) {
        // A listener must never break the agent loop.
        // eslint-disable-next-line no-console
        console.error(`[event-bus] handler for "${event}" threw:`, err.message);
      }
    }
  }
}

module.exports = { EventBus };
