import type { InvalidationEvent } from "../shared/contracts";

type Listener = (event: InvalidationEvent) => void;

export class EventHub {
  readonly #listeners = new Set<Listener>();

  publish(event: InvalidationEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
