import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { StorageCleanupJob } from './storage.cleanup.job';
import { StorageService } from './storage.service';

describe('StorageCleanupJob.cleanOrphanedFiles', () => {
  // Real StorageService on a temp dir: this job deletes files, so the test
  // checks the disk, not mock calls.
  let root: string;
  let storage: StorageService;

  const clients = [
    { id: 'client-nodomain', domain: null },
    { id: 'client-domain', domain: 'example.com' },
    // Two clients claiming one dir: an id equal to another client's domain.
    { id: 'shared.example', domain: null },
    { id: 'client-squatter', domain: 'shared.example' },
  ];
  const images = [
    { clientId: 'client-nodomain', storagePath: '' }, // set in beforeEach
    { clientId: 'client-domain', storagePath: '' },
  ];

  const prisma = {
    client: {
      findMany: jest.fn(async ({ where }) => {
        const [byDomain, byId] = where.OR;
        return clients.filter(
          (c) => c.domain === byDomain.domain || c.id === byId.id,
        );
      }),
    },
    image: {
      findMany: jest.fn(async ({ where }) =>
        images.filter((i) => i.clientId === where.clientId),
      ),
    },
    avatar: { findFirst: jest.fn().mockResolvedValue(null) },
  };

  const exists = (p: string) =>
    fs.access(p).then(
      () => true,
      () => false,
    );

  const makeImageDir = async (dir: string, imageId: string) => {
    const imageDir = storage.getImagePath(dir, imageId);
    await fs.mkdir(imageDir, { recursive: true });
    await fs.writeFile(path.join(imageDir, 'original.webp'), 'x');
    return imageDir;
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'fh-cleanup-'));
    storage = new StorageService({ get: () => root } as any);
    images[0].storagePath = storage.getImagePath('client-nodomain', 'img-kept');
    images[1].storagePath = storage.getImagePath('example.com', 'img-dom');
  });

  afterEach(() => fs.rm(root, { recursive: true, force: true }));

  it('keeps referenced images and deletes orphans, for clients with and without a domain', async () => {
    const kept = await makeImageDir('client-nodomain', 'img-kept');
    const orphan = await makeImageDir('client-nodomain', 'img-orphan');
    const keptDom = await makeImageDir('example.com', 'img-dom');
    const orphanDom = await makeImageDir('example.com', 'img-orphan-dom');

    await new StorageCleanupJob(storage, prisma as any).cleanOrphanedFiles();

    expect(await exists(kept)).toBe(true);
    expect(await exists(orphan)).toBe(false);
    expect(await exists(keptDom)).toBe(true);
    expect(await exists(orphanDom)).toBe(false);
  });

  it('leaves a storage dir that maps to no client untouched', async () => {
    const unknown = await makeImageDir('defaults.fileharbor', 'whatever');

    await new StorageCleanupJob(storage, prisma as any).cleanOrphanedFiles();

    expect(await exists(unknown)).toBe(true);
  });

  it('leaves a storage dir that maps to more than one client untouched', async () => {
    const ambiguous = await makeImageDir('shared.example', 'img');

    await new StorageCleanupJob(storage, prisma as any).cleanOrphanedFiles();

    expect(await exists(ambiguous)).toBe(true);
  });
});
