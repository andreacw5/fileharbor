import { Semaphore } from './semaphore';

describe('Semaphore', () => {
  const full = () => new Error('full');

  it('runs at most `limit` tasks at once and drains the queue', async () => {
    const sem = new Semaphore(2, 10);
    let running = 0;
    let peak = 0;
    const task = async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
    };

    await Promise.all(Array.from({ length: 6 }, () => sem.run(task, full)));

    expect(peak).toBe(2);
    expect(sem.running).toBe(0);
    expect(sem.pending).toBe(0);
  });

  it('rejects once the wait queue is full, without running the task', async () => {
    const sem = new Semaphore(1, 1);
    let release!: () => void;
    const blocker = sem.run(
      () => new Promise<void>((r) => (release = r)),
      full,
    );
    const queued = sem.run(async () => 'queued', full);
    const rejected = jest.fn(async () => 'never');

    await expect(sem.run(rejected, full)).rejects.toThrow('full');
    expect(rejected).not.toHaveBeenCalled();

    release();
    await blocker;
    await expect(queued).resolves.toBe('queued');
  });

  it('frees the slot when a task throws', async () => {
    const sem = new Semaphore(1, 0);
    await expect(
      sem.run(() => Promise.reject(new Error('boom')), full),
    ).rejects.toThrow('boom');
    await expect(sem.run(async () => 1, full)).resolves.toBe(1);
  });
});
