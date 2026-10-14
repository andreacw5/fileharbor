/**
 * Counting semaphore with a bounded wait queue. `run()` executes at most
 * `limit` tasks at once; past `limit + maxQueue` it rejects immediately
 * instead of letting waiters (and their buffers) pile up in memory.
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly limit: number,
    private readonly maxQueue: number,
  ) {}

  /** Throws `onFull()` without running `task` when the queue is full. */
  async run<T>(task: () => Promise<T>, onFull: () => Error): Promise<T> {
    if (this.active >= this.limit) {
      if (this.waiters.length >= this.maxQueue) {
        throw onFull();
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await task();
    } finally {
      // Hand the slot straight to the next waiter: `active` stays the same.
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    }
  }

  get pending(): number {
    return this.waiters.length;
  }

  get running(): number {
    return this.active;
  }
}
