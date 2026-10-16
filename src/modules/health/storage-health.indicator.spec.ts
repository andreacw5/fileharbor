import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { StorageHealthIndicator } from './storage-health.indicator';

// @nestjs/terminus 12 ships ESM that Jest can't load: stand in for the one
// class the indicator uses, with the same up/down result shape.
jest.mock('@nestjs/terminus', () => ({
  HealthIndicatorService: class {
    check(key: string) {
      return {
        up: (data = {}) => ({ [key]: { status: 'up', ...data } }),
        down: (data = {}) => ({ [key]: { status: 'down', ...data } }),
      };
    }
  },
}));

describe('StorageHealthIndicator', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fh-health-'));
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const indicatorFor = (storagePath: string, minFreeMb: number) =>
    new StorageHealthIndicator(
      new (jest.requireMock('@nestjs/terminus').HealthIndicatorService)(),
      new ConfigService({
        STORAGE_PATH: storagePath,
        HEALTH_DISK_MIN_FREE_MB: minFreeMb,
      }),
    );

  it('is up on a writable path above the free-space threshold', async () => {
    const result = await indicatorFor(dir, 0).check('storage');

    expect(result.storage).toMatchObject({ status: 'up', minFreeMb: 0 });
  });

  it('is down below the free-space threshold', async () => {
    const result = await indicatorFor(dir, Number.MAX_SAFE_INTEGER).check(
      'storage',
    );

    expect(result.storage).toMatchObject({
      status: 'down',
      message: 'Free space below threshold',
    });
  });

  it('is down when the path is missing, without leaking it', async () => {
    const missing = path.join(dir, 'nope');
    const result = await indicatorFor(missing, 0).check('storage');

    expect(result.storage).toEqual({
      status: 'down',
      message: 'Storage not writable: ENOENT',
    });
  });
});
