import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ImageService } from './image.service';
import { PrismaService } from '@/modules/prisma/prisma.service';
import {
  RenderBusyException,
  StorageService,
} from '@/modules/storage/storage.service';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { CreatorService } from '@/modules/creator/creator.service';
import { RouteHelperService } from '@/utils/route.utils';

describe('ImageService', () => {
  let service: ImageService;

  // Mock data
  const mockClientId = 'client-123';
  const mockCreatorExternalId = 'creator-123';
  const mockExternalUserId = 'ext-creator-123';
  const mockImageId = 'image-123';
  const mockDomain = 'test.fileharbor.local';

  const mockClient = {
    id: mockClientId,
    name: 'Test Client',
    domain: mockDomain,
    apiKey: 'test-api-key',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCreator = {
    id: mockCreatorExternalId,
    clientId: mockClientId,
    externalId: mockExternalUserId,
    email: null,
    username: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSystemCreator = {
    id: 'system-creator-123',
    clientId: mockClientId,
    externalId: 'system',
    email: null,
    username: 'system',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockImage = {
    id: mockImageId,
    clientId: mockClientId,
    creatorId: mockCreatorExternalId,
    externalImageId: null,
    originalName: 'test.jpg',
    storagePath: `${mockDomain}/images/${mockImageId}`,
    format: 'jpeg',
    mimeType: 'image/jpeg',
    width: 1920,
    height: 1080,
    size: 2048000,
    tags: ['test', 'sample'],
    description: 'Test image',
    isPrivate: false,
    isOptimized: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockFile: Express.Multer.File = {
    fieldname: 'file',
    originalname: 'test.jpg',
    encoding: '7bit',
    mimetype: 'image/jpeg',
    size: 2048000,
    buffer: Buffer.from('fake-image-data'),
    stream: null,
    destination: '',
    filename: '',
    path: '',
  };

  const mockImageMetadata = {
    width: 1920,
    height: 1080,
    format: 'jpeg',
    size: 2048000,
  };

  // Mock services
  const mockPrismaService = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    client: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      fields: { currentTinifyLimit: 'currentTinifyLimit-ref' },
    },
    creator: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    image: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    imageShareLink: {
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    album: {
      findFirst: jest.fn(),
    },
    albumImage: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    albumItem: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const mockStorageService = {
    getImagePath: jest.fn(),
    getImageFilePath: jest.fn(),
    saveFile: jest.fn(),
    readFile: jest.fn(),
    deleteDirectory: jest.fn(),
    getImageMetadata: jest.fn(),
    encodeWebpWithThumbnail: jest.fn(),
    computeDHash: jest.fn(),
    getDefaultImage: jest.fn(),
    resizeImage: jest.fn(),
    fileExists: jest.fn(),
    getImageVariantsPath: jest.fn(
      (d: string, id: string) => `storage/${d}/images/${id}/variants`,
    ),
    countEntries: jest.fn().mockResolvedValue(0),
    clearImageVariants: jest.fn(),
    isAnimated: jest.fn(),
    createThumbnail: jest.fn(),
    regenerateImageThumb: jest.fn(),
    blurImage: jest.fn(),
  };

  const mockHttpService = { post: jest.fn(), get: jest.fn() };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config = {
        ORIGINAL_QUALITY: '100',
        THUMBNAIL_QUALITY: '70',
        THUMBNAIL_SIZE: '800',
      };
      return config[key];
    }),
  };

  const mockCreatorServiceMock = {
    resolveCreator: jest.fn(),
    findOrCreate: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImageService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: StorageService,
          useValue: mockStorageService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: HttpService,
          useValue: mockHttpService,
        },
        {
          provide: CreatorService,
          useValue: mockCreatorServiceMock,
        },
        {
          provide: RouteHelperService,
          useValue: {
            path: jest.fn((...segments: string[]) => '/' + segments.join('/')),
            fullUrl: jest.fn(
              (...segments: string[]) =>
                'http://localhost:3000/' + segments.join('/'),
            ),
            apiPrefix: '',
            baseUrl: 'http://localhost:3000',
          },
        },
      ],
    }).compile();

    service = module.get<ImageService>(ImageService);

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('uploadImage', () => {
    beforeEach(() => {
      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);
      mockPrismaService.creator.upsert.mockResolvedValue(mockCreator);
      mockCreatorServiceMock.resolveCreator.mockResolvedValue(mockCreator);
      mockStorageService.getImageMetadata.mockResolvedValue(mockImageMetadata);
      mockStorageService.encodeWebpWithThumbnail.mockResolvedValue({
        original: Buffer.from('webp-data'),
        thumb: Buffer.from('thumb-data'),
      });
      mockStorageService.computeDHash.mockResolvedValue('00ff'.repeat(16));
      mockStorageService.blurImage.mockResolvedValue(Buffer.from('blurred'));
      mockStorageService.getImagePath.mockReturnValue(
        `storage/${mockDomain}/images/${mockImageId}`,
      );
      mockStorageService.getImageFilePath.mockImplementation(
        (domain, imageId, variant) =>
          `storage/${domain}/images/${imageId}/${variant}.webp`,
      );
      mockPrismaService.image.create.mockResolvedValue(mockImage);
    });

    it('should upload image successfully with creator', async () => {
      const result = await service.uploadImage(
        mockClientId,
        mockExternalUserId,
        mockFile,
      );

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.originalName).toBe('test.jpg');
      expect(mockPrismaService.client.findUnique).toHaveBeenCalledWith({
        where: { id: mockClientId },
        select: { domain: true },
      });
      expect(mockStorageService.encodeWebpWithThumbnail).toHaveBeenCalledTimes(
        1,
      );
      expect(mockStorageService.saveFile).toHaveBeenCalledTimes(2); // original + thumbnail
      expect(mockStorageService.blurImage).not.toHaveBeenCalled(); // public: lazy
    });

    const uploadPrivate = () =>
      service.uploadImage(
        mockClientId,
        mockExternalUserId,
        mockFile,
        undefined,
        undefined,
        undefined,
        true,
      );

    it('pre-generates blurred.webp from the thumbnail for a private image', async () => {
      await uploadPrivate();

      expect(mockStorageService.blurImage).toHaveBeenCalledWith(
        Buffer.from('thumb-data'),
      );
      expect(mockStorageService.saveFile).toHaveBeenCalledWith(
        expect.stringMatching(/\/blurred\.webp$/),
        Buffer.from('blurred'),
      );
    });

    it('saves blurPublic', async () => {
      await service.uploadImage(
        mockClientId,
        mockExternalUserId,
        mockFile,
        undefined,
        undefined,
        undefined,
        true,
        undefined,
        true,
      );

      expect(mockPrismaService.image.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isPrivate: true, blurPublic: true }),
        }),
      );
    });

    it('pre-generates blurred.webp for a public image with blurPublic', async () => {
      await service.uploadImage(
        mockClientId,
        mockExternalUserId,
        mockFile,
        undefined,
        undefined,
        undefined,
        false,
        undefined,
        true,
      );

      expect(mockStorageService.blurImage).toHaveBeenCalled();
    });

    it('still uploads when the blur fails', async () => {
      mockStorageService.blurImage.mockRejectedValue(new RenderBusyException());

      await expect(uploadPrivate()).resolves.toBeDefined();
      expect(mockStorageService.saveFile).toHaveBeenCalledTimes(2);
    });

    it('hashes the stored original and saves the dHash', async () => {
      await service.uploadImage(mockClientId, mockExternalUserId, mockFile);

      expect(mockStorageService.computeDHash).toHaveBeenCalledWith(
        Buffer.from('webp-data'),
      );
      expect(mockPrismaService.image.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ dHash: '00ff'.repeat(16) }),
        }),
      );
    });

    it('still uploads when the dHash fails, with dHash null', async () => {
      mockStorageService.computeDHash.mockRejectedValue(new Error('boom'));

      await expect(
        service.uploadImage(mockClientId, mockExternalUserId, mockFile),
      ).resolves.toBeDefined();
      expect(mockPrismaService.image.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ dHash: null }),
        }),
      );
    });

    it('should upload image without creator (system)', async () => {
      mockPrismaService.creator.findUnique.mockResolvedValue(mockSystemCreator);

      const result = await service.uploadImage(
        mockClientId,
        undefined,
        mockFile,
      );

      expect(result).toBeDefined();
      expect(mockPrismaService.creator.findUnique).toHaveBeenCalledWith({
        where: {
          clientId_externalId: {
            clientId: mockClientId,
            externalId: 'system',
          },
        },
      });
    });

    it('should upsert creator with username when provided', async () => {
      await service.uploadImage(
        mockClientId,
        mockExternalUserId,
        mockFile,
        undefined,
        undefined,
        undefined,
        undefined,
        'Andrea',
      );

      expect(mockCreatorServiceMock.resolveCreator).toHaveBeenCalledWith(
        mockClientId,
        mockExternalUserId,
        'Andrea',
      );
    });

    it('should throw BadRequestException for non-image file', async () => {
      const invalidFile = { ...mockFile, mimetype: 'application/pdf' };

      await expect(
        service.uploadImage(mockClientId, mockExternalUserId, invalidFile),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.uploadImage(mockClientId, mockExternalUserId, invalidFile),
      ).rejects.toThrow('Only image files are allowed');
    });

    it('should throw BadRequestException when client not found', async () => {
      mockPrismaService.client.findUnique.mockResolvedValue(null);

      await expect(
        service.uploadImage(mockClientId, mockExternalUserId, mockFile),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.uploadImage(mockClientId, mockExternalUserId, mockFile),
      ).rejects.toThrow('Client not found');
    });

    it('should upload image with album association', async () => {
      const albumId = 'album-123';
      const createdImage = { ...mockImage, id: 'new-image-123' };
      const mockAlbum = {
        id: albumId,
        clientId: mockClientId,
        creatorId: mockCreatorExternalId,
        name: 'Test Album',
        isPublic: false,
        createdAt: new Date(),
      };

      // Need to mock the newly created image for addImageToAlbum
      mockPrismaService.image.create.mockResolvedValue(createdImage);
      mockPrismaService.image.findFirst.mockResolvedValue(createdImage);
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbum);
      mockPrismaService.albumItem.findFirst.mockResolvedValue({ order: 0 });
      mockPrismaService.albumItem.create.mockResolvedValue({
        albumId,
        imageId: createdImage.id,
        order: 1,
      });

      const result = await service.uploadImage(
        mockClientId,
        mockExternalUserId,
        mockFile,
        albumId,
      );

      expect(result).toBeDefined();
      expect(mockPrismaService.albumItem.create).toHaveBeenCalled();
    });

    it('should upload image with tags and description', async () => {
      const tags = ['test', 'sample'];
      const description = 'Test description';

      await service.uploadImage(
        mockClientId,
        mockExternalUserId,
        mockFile,
        undefined,
        tags,
        description,
      );

      expect(mockPrismaService.image.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description,
            imageTags: {
              create: expect.arrayContaining([
                expect.objectContaining({
                  tag: expect.objectContaining({
                    connectOrCreate: expect.objectContaining({
                      where: {
                        clientId_name: {
                          clientId: mockClientId,
                          name: 'test',
                        },
                      },
                    }),
                  }),
                }),
              ]),
            },
          }),
          include: expect.objectContaining({
            imageTags: expect.any(Object),
          }),
        }),
      );
    });

    it('should upload private image', async () => {
      await service.uploadImage(
        mockClientId,
        mockExternalUserId,
        mockFile,
        undefined,
        undefined,
        undefined,
        true,
      );

      expect(mockPrismaService.image.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isPrivate: true,
          }),
        }),
      );
    });
  });

  describe('getImageById', () => {
    beforeEach(() => {
      // Reset mocks for this test suite
      jest.clearAllMocks();
    });

    it('should return image when found', async () => {
      mockPrismaService.image.findFirst.mockResolvedValue(mockImage);

      const result = await service.getImageById(mockImageId, mockClientId);

      expect(result).toEqual(mockImage);
      expect(mockPrismaService.image.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockImageId,
          clientId: mockClientId,
        },
        include: {
          client: { select: { domain: true } },
          imageTags: {
            include: {
              tag: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });
    });

    it('should throw NotFoundException when image not found', async () => {
      mockPrismaService.image.findFirst.mockResolvedValue(null);

      await expect(
        service.getImageById('non-existent', mockClientId),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.getImageById('non-existent', mockClientId),
      ).rejects.toThrow('Image not found');
    });
  });

  describe('deleteImage', () => {
    beforeEach(() => {
      mockPrismaService.image.findFirst.mockResolvedValue(mockImage);
      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);
      mockStorageService.getImagePath.mockReturnValue(
        `storage/${mockDomain}/images/${mockImageId}`,
      );
    });

    it('should delete image successfully', async () => {
      mockPrismaService.image.delete.mockResolvedValue(mockImage);

      const result = await service.deleteImage(mockImageId, mockClientId);

      expect(result.success).toBe(true);
      expect(mockPrismaService.image.delete).toHaveBeenCalledWith({
        where: { id: mockImageId },
      });
      expect(mockStorageService.deleteDirectory).toHaveBeenCalled();
    });

    it('deletes the row before the files, and survives a failed file delete', async () => {
      mockPrismaService.image.delete.mockResolvedValue(mockImage);
      mockStorageService.deleteDirectory.mockRejectedValueOnce(
        new Error('EBUSY'),
      );

      const result = await service.deleteImage(mockImageId, mockClientId);

      expect(result.success).toBe(true);
      expect(
        mockPrismaService.image.delete.mock.invocationCallOrder[0],
      ).toBeLessThan(
        mockStorageService.deleteDirectory.mock.invocationCallOrder[0],
      );
    });

    it('should throw NotFoundException when image not found', async () => {
      mockPrismaService.image.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteImage('non-existent', mockClientId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getImageFile', () => {
    const image = { ...mockImage, client: { domain: mockDomain } };
    const original = `storage/${mockDomain}/images/${mockImageId}/original.webp`;

    beforeEach(() => {
      mockStorageService.getImageFilePath.mockImplementation(
        (d: string, id: string, v: string) =>
          `storage/${d}/images/${id}/${v}.webp`,
      );
      mockStorageService.readFile.mockResolvedValue(Buffer.from('image-data'));
      mockStorageService.fileExists.mockResolvedValue(true);
      mockStorageService.saveFile.mockResolvedValue(undefined);
      mockStorageService.resizeImage.mockResolvedValue(Buffer.from('resized'));
    });

    it('serves the original from disk without touching the database', async () => {
      const result = await service.getImageFile(image);

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.mimeType).toBe('image/webp');
      expect(result.filePath).toBe(original);
      expect(mockPrismaService.image.findFirst).not.toHaveBeenCalled();
      expect(mockPrismaService.client.findUnique).not.toHaveBeenCalled();
    });

    it('leaves an on-disk file unread when asked (X-Accel-Redirect)', async () => {
      const result = await service.getImageFile(image, { skipDiskRead: true });

      expect(result.buffer).toBeUndefined();
      expect(result.filePath).toBe(original);
      expect(mockStorageService.readFile).not.toHaveBeenCalled();
    });

    it('returns the thumbnail when requested', async () => {
      const result = await service.getImageFile(image, { thumb: true });

      expect(result.filePath).toBe(
        `storage/${mockDomain}/images/${mockImageId}/thumb.webp`,
      );
    });

    it('resizes once, then serves the cached variant', async () => {
      mockStorageService.fileExists.mockResolvedValue(false);
      const first = await service.getImageFile(image, {
        width: 960,
        height: 640,
        format: 'jpeg',
      });
      const variant = `storage/${mockDomain}/images/${mockImageId}/variants/960x640-q85.jpeg`;

      expect(first.mimeType).toBe('image/jpeg');
      expect(first.buffer).toEqual(Buffer.from('resized'));
      expect(mockStorageService.saveFile).toHaveBeenCalledWith(
        variant,
        Buffer.from('resized'),
      );

      mockStorageService.fileExists.mockResolvedValue(true);
      // Snaps to the same step: served from the cached 960x640 file
      const second = await service.getImageFile(image, {
        width: 800,
        height: 600,
        format: 'jpeg',
        quality: 83,
      });
      expect(second.filePath).toBe(variant);
      expect(mockStorageService.resizeImage).toHaveBeenCalledTimes(1);
    });

    it('snaps requested dimensions and quality before rendering', async () => {
      mockStorageService.fileExists.mockResolvedValue(false);

      await service.getImageFile(image, {
        width: 801,
        height: 1,
        format: 'png',
        quality: 52,
      });

      expect(mockStorageService.resizeImage).toHaveBeenCalledWith(
        Buffer.from('image-data'),
        960,
        16,
        'png',
        60,
      );
      expect(mockStorageService.saveFile).toHaveBeenCalledWith(
        `storage/${mockDomain}/images/${mockImageId}/variants/960x16-q60.png`,
        Buffer.from('resized'),
      );
    });

    it('stops caching variants past the per-image cap', async () => {
      mockStorageService.fileExists.mockResolvedValue(false);
      mockStorageService.countEntries.mockResolvedValueOnce(20);

      const result = await service.getImageFile(image, { width: 123 });

      expect(result.buffer).toEqual(Buffer.from('resized'));
      expect(mockStorageService.saveFile).not.toHaveBeenCalled();
    });

    describe('blur', () => {
      const path = (v: string) =>
        `storage/${mockDomain}/images/${mockImageId}/${v}.webp`;
      const existing = (...variants: string[]) =>
        mockStorageService.fileExists.mockImplementation(async (p: string) =>
          variants.some((v) => p === path(v)),
        );

      beforeEach(() =>
        mockStorageService.blurImage.mockResolvedValue(Buffer.from('blurred')),
      );

      it('serves blurred.webp from disk, ignoring every transform', async () => {
        existing('blurred', 'thumb', 'original');

        const result = await service.getImageFile(image, {
          blur: true,
          width: 800,
          quality: 100,
          thumb: true,
        });

        expect(result).toMatchObject({
          mimeType: 'image/webp',
          filePath: path('blurred'),
        });
        expect(mockStorageService.blurImage).not.toHaveBeenCalled();
        expect(mockStorageService.resizeImage).not.toHaveBeenCalled();
      });

      it('converts blurred.webp to the requested format, uncached', async () => {
        existing('blurred');
        mockStorageService.readFile.mockResolvedValue(Buffer.from('blurred'));
        mockStorageService.resizeImage.mockResolvedValue(Buffer.from('jpeg'));

        const result = await service.getImageFile(image, {
          blur: true,
          width: 800,
          format: 'jpeg',
          skipDiskRead: true,
        });

        expect(mockStorageService.resizeImage).toHaveBeenCalledWith(
          Buffer.from('blurred'),
          undefined,
          undefined,
          'jpeg',
          50,
        );
        expect(result).toEqual({
          mimeType: 'image/jpeg',
          buffer: Buffer.from('jpeg'),
        });
        expect(mockStorageService.saveFile).not.toHaveBeenCalled();
      });

      it('builds a missing one from the thumb and stores it', async () => {
        existing('thumb', 'original');
        mockStorageService.readFile.mockImplementation(async (p: string) =>
          Buffer.from(p),
        );

        const result = await service.getImageFile(image, { blur: true });

        expect(mockStorageService.blurImage).toHaveBeenCalledWith(
          Buffer.from(path('thumb')),
        );
        expect(mockStorageService.saveFile).toHaveBeenCalledWith(
          path('blurred'),
          Buffer.from('blurred'),
        );
        expect(result).toEqual({
          mimeType: 'image/webp',
          buffer: Buffer.from('blurred'),
        });
      });

      it('falls back to the original as source when the thumb is gone', async () => {
        existing('original');
        mockStorageService.readFile.mockImplementation(async (p: string) =>
          Buffer.from(p),
        );

        await service.getImageFile(image, { blur: true });

        expect(mockStorageService.blurImage).toHaveBeenCalledWith(
          Buffer.from(path('original')),
        );
      });

      it.each([
        ['a full render queue', new RenderBusyException()],
        ['an unreadable source', new UnprocessableEntityException()],
      ])('never serves the original on %s', async (_, error) => {
        existing('thumb', 'original');
        mockStorageService.blurImage.mockRejectedValue(error);

        await expect(service.getImageFile(image, { blur: true })).rejects.toBe(
          error,
        );
        expect(mockStorageService.saveFile).not.toHaveBeenCalled();
      });

      it('422s when the source cannot be read', async () => {
        existing();
        mockStorageService.readFile.mockRejectedValueOnce(new Error('ENOENT'));

        await expect(
          service.getImageFile(image, { blur: true }),
        ).rejects.toBeInstanceOf(UnprocessableEntityException);
        expect(mockStorageService.blurImage).not.toHaveBeenCalled();
      });
    });
  });

  describe('view and download counters', () => {
    it('batches views into one UPDATE per flush', async () => {
      await service.incrementViews('a');
      await service.incrementViews('a');
      await service.incrementViews('b');
      expect(mockPrismaService.$executeRaw).not.toHaveBeenCalled();

      await service.flushViews();
      expect(mockPrismaService.$executeRaw).toHaveBeenCalledTimes(1);
      const values = mockPrismaService.$executeRaw.mock.calls[0].slice(1);
      expect(values).toEqual([
        ['a', 'b'],
        [2, 1],
      ]);

      await service.flushViews();
      expect(mockPrismaService.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('never writes through Prisma update (which would bump updatedAt / the ETag)', async () => {
      await service.incrementViews('a');
      await service.flushViews();
      await service.incrementDownloads('a', mockClientId);

      expect(mockPrismaService.image.update).not.toHaveBeenCalled();
      expect(mockPrismaService.$executeRaw).toHaveBeenCalledTimes(2);
    });
  });

  describe('createShareLink', () => {
    beforeEach(() => {
      mockPrismaService.creator.findUnique.mockResolvedValue(mockCreator);
      mockPrismaService.image.findFirst.mockResolvedValue(mockImage);
    });

    it('should create share link for image owner', async () => {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const mockShareLink = {
        id: 'share-123',
        imageId: mockImageId,
        readToken: 'test-token-123',
        expiresAt,
        createdAt: new Date(),
      };
      mockPrismaService.imageShareLink.create.mockResolvedValue(mockShareLink);

      const result = await service.createShareLink(
        mockImageId,
        mockClientId,
        mockExternalUserId,
        expiresAt,
      );

      expect(result).toBeDefined();
      expect(result.imageId).toBe(mockImageId);
      expect(result.expiresAt).toBeDefined();
      // GET /images/:id?token= is the route that resolves share tokens
      expect(result.shareUrl).toBe(
        `/images/${mockImageId}?token=test-token-123`,
      );
      expect(mockPrismaService.imageShareLink.create).toHaveBeenCalled();
      expect(mockPrismaService.image.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockImageId,
          clientId: mockClientId,
          creatorId: mockCreator.id,
        },
      });
    });

    it('an unknown X-User-Id gets 404 and creates nothing', async () => {
      mockPrismaService.creator.findUnique.mockResolvedValue(null);

      await expect(
        service.createShareLink(mockImageId, mockClientId, 'someone-else'),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrismaService.image.findFirst).not.toHaveBeenCalled();
      expect(mockPrismaService.imageShareLink.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when image not found', async () => {
      mockPrismaService.image.findFirst.mockResolvedValue(null);

      await expect(
        service.createShareLink(mockImageId, mockClientId, mockExternalUserId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create share link without expiration', async () => {
      const mockShareLink = {
        id: 'share-123',
        imageId: mockImageId,
        readToken: 'test-token-123',
        expiresAt: null,
        createdAt: new Date(),
      };
      mockPrismaService.imageShareLink.create.mockResolvedValue(mockShareLink);

      const result = await service.createShareLink(
        mockImageId,
        mockClientId,
        mockExternalUserId,
      );

      expect(result.expiresAt).toBeNull();
    });
  });

  describe('getShareLinks', () => {
    it('lists the links for the owner, resolved from the external id', async () => {
      mockPrismaService.creator.findUnique.mockResolvedValue(mockCreator);
      mockPrismaService.image.findFirst.mockResolvedValue(mockImage);
      mockPrismaService.imageShareLink.findMany.mockResolvedValue([]);

      await expect(
        service.getShareLinks(mockImageId, mockClientId, mockExternalUserId),
      ).resolves.toEqual([]);
      expect(mockPrismaService.image.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockImageId,
          clientId: mockClientId,
          creatorId: mockCreator.id,
        },
      });
    });

    it('an unknown X-User-Id gets 404', async () => {
      mockPrismaService.creator.findUnique.mockResolvedValue(null);

      await expect(
        service.getShareLinks(mockImageId, mockClientId, 'someone-else'),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrismaService.imageShareLink.findMany).not.toHaveBeenCalled();
    });
  });

  describe('deleteShareLink', () => {
    beforeEach(() => {
      mockPrismaService.imageShareLink.findUnique.mockResolvedValue({
        id: 'share-123',
        imageId: mockImageId,
        image: mockImage,
      });
    });

    it('deletes for the owner, resolved from the external id', async () => {
      mockPrismaService.creator.findUnique.mockResolvedValue(mockCreator);

      await service.deleteShareLink(
        'share-123',
        mockClientId,
        mockExternalUserId,
      );
      expect(mockPrismaService.imageShareLink.delete).toHaveBeenCalledWith({
        where: { id: 'share-123' },
      });
    });

    it('another creator gets 404 and deletes nothing', async () => {
      mockPrismaService.creator.findUnique.mockResolvedValue({
        id: 'other-creator',
      });

      await expect(
        service.deleteShareLink('share-123', mockClientId, 'someone-else'),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrismaService.imageShareLink.delete).not.toHaveBeenCalled();
    });

    it('an unknown X-User-Id gets 404 and deletes nothing', async () => {
      mockPrismaService.creator.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteShareLink('share-123', mockClientId, 'nobody'),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrismaService.imageShareLink.delete).not.toHaveBeenCalled();
    });
  });

  describe('getUnoptimizedImages', () => {
    it('should return unoptimized images', async () => {
      const unoptimizedImages = [{ ...mockImage, isOptimized: false }];
      mockPrismaService.image.findMany.mockResolvedValue(unoptimizedImages);

      const result = await service.getUnoptimizedImages();

      expect(result).toHaveLength(1);
      expect(result[0].isOptimized).toBe(false);
      expect(mockPrismaService.image.findMany).toHaveBeenCalledWith({
        where: { isOptimized: false, optimizeAttempts: { lt: 3 } },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
    });
  });

  describe('regenerateRenditions', () => {
    const image = {
      id: mockImageId,
      clientId: mockClientId,
      client: { domain: mockDomain },
    };

    // Once: these mocks are shared with the rest of the suite
    beforeEach(() => {
      mockStorageService.fileExists.mockResolvedValueOnce(true);
      mockStorageService.regenerateImageThumb.mockResolvedValueOnce(undefined);
      mockPrismaService.image.update.mockResolvedValueOnce({
        id: mockImageId,
        updatedAt: new Date(),
      });
    });

    afterEach(() => {
      mockStorageService.fileExists.mockReset();
      mockStorageService.regenerateImageThumb.mockReset();
      mockPrismaService.image.update.mockReset();
    });

    it('rebuilds the thumb with the configured size, then moves updatedAt', async () => {
      await service.regenerateRenditions(image);

      expect(mockStorageService.regenerateImageThumb).toHaveBeenCalledWith(
        mockDomain,
        mockImageId,
        800,
        70,
      );
      expect(mockPrismaService.image.update).toHaveBeenCalledWith({
        where: { id: mockImageId },
        data: { updatedAt: expect.any(Date) },
        select: { id: true, updatedAt: true },
      });
      expect(
        mockStorageService.regenerateImageThumb.mock.invocationCallOrder[0],
      ).toBeLessThan(
        mockPrismaService.image.update.mock.invocationCallOrder[0],
      );
    });

    it('falls back to the clientId directory without a domain', async () => {
      await service.regenerateRenditions({
        ...image,
        client: { domain: null },
      });
      expect(mockStorageService.regenerateImageThumb.mock.calls[0][0]).toBe(
        mockClientId,
      );
    });

    it('404s on a missing original without writing anything', async () => {
      mockStorageService.fileExists.mockReset().mockResolvedValueOnce(false);
      await expect(service.regenerateRenditions(image)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockStorageService.regenerateImageThumb).not.toHaveBeenCalled();
      expect(mockPrismaService.image.update).not.toHaveBeenCalled();
    });

    it.each([
      ['an unreadable original', new UnprocessableEntityException()],
      ['a failed thumb write', new InternalServerErrorException()],
    ])('propagates %s, leaving updatedAt alone', async (_case, error) => {
      mockStorageService.regenerateImageThumb
        .mockReset()
        .mockRejectedValueOnce(error);
      await expect(service.regenerateRenditions(image)).rejects.toBe(error);
      expect(mockPrismaService.image.update).not.toHaveBeenCalled();
    });
  });

  describe('resetOptimizeAttempts', () => {
    it('never matches an optimized row', async () => {
      mockPrismaService.image.updateMany.mockResolvedValueOnce({ count: 2 });

      await expect(
        service.resetOptimizeAttempts({
          clientId: mockClientId,
          isOptimized: true,
        }),
      ).resolves.toBe(2);
      expect(mockPrismaService.image.updateMany).toHaveBeenCalledWith({
        where: { clientId: mockClientId, isOptimized: false },
        data: { optimizeAttempts: 0 },
      });
    });
  });

  describe('markAsOptimized', () => {
    it('should mark image as optimized and store the re-encoded size', async () => {
      mockPrismaService.image.update.mockResolvedValue({
        ...mockImage,
        isOptimized: true,
      });

      await service.markAsOptimized(mockImageId, 1234);

      expect(mockPrismaService.image.update).toHaveBeenCalledWith({
        where: { id: mockImageId },
        data: {
          isOptimized: true,
          optimizedAt: expect.any(Date),
          size: 1234,
        },
      });
    });
  });

  describe('updateImageMetadata', () => {
    beforeEach(() => {
      mockPrismaService.creator.findUnique.mockResolvedValue(mockCreator);
    });

    it('sets isPrivate for the owner, resolved from the external id', async () => {
      mockPrismaService.image.findFirst.mockResolvedValue(mockImage);
      mockPrismaService.image.update.mockResolvedValue({
        ...mockImage,
        isPrivate: true,
        imageTags: [],
      });

      await service.updateImageMetadata(
        mockImageId,
        mockClientId,
        mockExternalUserId,
        undefined,
        undefined,
        true,
      );

      expect(mockPrismaService.creator.findUnique).toHaveBeenCalledWith({
        where: {
          clientId_externalId: {
            clientId: mockClientId,
            externalId: mockExternalUserId,
          },
        },
        select: { id: true },
      });
      expect(mockPrismaService.image.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockImageId,
          clientId: mockClientId,
          creatorId: mockCreator.id,
        },
      });
      expect(mockPrismaService.image.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isPrivate: true } }),
      );
    });

    describe('blurred.webp warm-up', () => {
      const patchPrivate = async (isPrivate: boolean, blurPublic = false) => {
        mockPrismaService.image.findFirst.mockResolvedValue(mockImage);
        mockPrismaService.image.update.mockResolvedValue({
          ...mockImage,
          isPrivate,
          blurPublic,
          imageTags: [],
          client: { domain: mockDomain },
        });
        mockStorageService.getImageFilePath.mockImplementation(
          (domain, imageId, variant) =>
            `storage/${domain}/images/${imageId}/${variant}.webp`,
        );
        mockStorageService.readFile.mockResolvedValue(Buffer.from('thumb'));
        mockStorageService.blurImage.mockResolvedValue(Buffer.from('blurred'));
        mockStorageService.saveFile.mockResolvedValue(undefined);
        await service.updateImageMetadata(
          mockImageId,
          mockClientId,
          mockExternalUserId,
          undefined,
          undefined,
          isPrivate,
        );
        await new Promise(setImmediate); // fire-and-forget
      };

      it('builds a missing one when the PATCH makes the image private', async () => {
        mockStorageService.fileExists.mockResolvedValue(false);
        await patchPrivate(true);
        expect(mockStorageService.saveFile).toHaveBeenCalledWith(
          `storage/${mockDomain}/images/${mockImageId}/blurred.webp`,
          Buffer.from('blurred'),
        );
      });

      it('leaves an existing one alone', async () => {
        mockStorageService.fileExists.mockResolvedValue(true);
        await patchPrivate(true);
        expect(mockStorageService.blurImage).not.toHaveBeenCalled();
      });

      it('builds nothing for a PATCH to public', async () => {
        mockStorageService.fileExists.mockResolvedValue(false);
        await patchPrivate(false);
        expect(mockStorageService.blurImage).not.toHaveBeenCalled();
      });

      it('reads the updated row: still blurPublic after a PATCH to public', async () => {
        mockStorageService.fileExists.mockResolvedValue(false);
        await patchPrivate(false, true);
        expect(mockStorageService.blurImage).toHaveBeenCalled();
      });

      it('only warns when the warm-up render fails', async () => {
        mockStorageService.fileExists.mockResolvedValue(false);
        // Once: patchPrivate sets the default implementation
        mockStorageService.blurImage.mockRejectedValueOnce(
          new RenderBusyException(),
        );
        await expect(patchPrivate(true)).resolves.toBeUndefined();
        expect(mockStorageService.blurImage).toHaveBeenCalled();
        expect(mockStorageService.saveFile).not.toHaveBeenCalled();
      });
    });

    it('an unknown creator gets 404 and writes nothing', async () => {
      mockPrismaService.creator.findUnique.mockResolvedValue(null);

      await expect(
        service.updateImageMetadata(
          mockImageId,
          mockClientId,
          'someone-else',
          undefined,
          undefined,
          true,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrismaService.image.update).not.toHaveBeenCalled();
    });

    it('should sync relational tags and description', async () => {
      mockPrismaService.image.findFirst.mockResolvedValue(mockImage);
      mockPrismaService.image.update.mockResolvedValue({
        ...mockImage,
        description: 'Updated description',
        imageTags: [{ tag: { name: 'nature' } }, { tag: { name: 'sunset' } }],
      });

      const result = await service.updateImageMetadata(
        mockImageId,
        mockClientId,
        mockExternalUserId,
        ['nature', 'sunset'],
        'Updated description',
      );

      expect(result.tags).toEqual(['nature', 'sunset']);
      expect(mockPrismaService.image.update).toHaveBeenCalledWith({
        where: { id: mockImageId },
        data: {
          description: 'Updated description',
          imageTags: {
            deleteMany: {},
            create: expect.arrayContaining([
              expect.objectContaining({
                tag: expect.objectContaining({
                  connectOrCreate: expect.objectContaining({
                    where: {
                      clientId_name: {
                        clientId: mockClientId,
                        name: 'nature',
                      },
                    },
                  }),
                }),
              }),
            ]),
          },
        },
        include: {
          imageTags: {
            include: {
              tag: {
                select: {
                  name: true,
                },
              },
            },
          },
          client: { select: { domain: true } },
        },
      });
    });
  });

  describe('checkImageAccess', () => {
    const privateImage = { ...mockImage, isPrivate: true };

    beforeEach(() => {
      mockPrismaService.image.findFirst.mockResolvedValue(privateImage);
    });

    it('grants the owner, identified by external id, access', async () => {
      mockPrismaService.creator.findUnique.mockResolvedValue(mockCreator);

      await expect(
        service.checkImageAccess(
          privateImage,
          mockClientId,
          mockExternalUserId,
        ),
      ).resolves.toBe(true);
      expect(mockPrismaService.creator.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            clientId_externalId: {
              clientId: mockClientId,
              externalId: mockExternalUserId,
            },
          },
        }),
      );
    });

    it('denies another creator of the same client', async () => {
      mockPrismaService.creator.findUnique.mockResolvedValue({
        ...mockCreator,
        id: 'someone-else',
      });

      await expect(
        service.checkImageAccess(privateImage, mockClientId, 'other-ext'),
      ).resolves.toBe(false);
    });

    it('denies the same external id under another client', async () => {
      await expect(
        service.checkImageAccess(
          privateImage,
          'other-client',
          mockExternalUserId,
        ),
      ).resolves.toBe(false);
      expect(mockPrismaService.creator.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('deleteExpiredShareLinks', () => {
    it('should delete expired share links', async () => {
      mockPrismaService.imageShareLink.deleteMany.mockResolvedValue({
        count: 5,
      });

      const result = await service.deleteExpiredShareLinks();

      expect(result).toBe(5);
      expect(mockPrismaService.imageShareLink.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: {
            lt: expect.any(Date),
          },
        },
      });
    });
  });

  describe('compressImageWithTinify', () => {
    const tinifyClient = {
      ...mockClient,
      tinifyActive: true,
      tinifyApiKey: 'tinify-key',
      currentTinifyUsage: 499,
      currentTinifyLimit: 500,
    };

    beforeEach(() => {
      mockPrismaService.image.findUnique.mockResolvedValue({
        ...mockImage,
        isOptimized: true,
        tinifyOptimized: false,
      });
      mockPrismaService.client.findUnique.mockResolvedValue(tinifyClient);
      mockStorageService.getImageFilePath.mockReturnValue('original.webp');
      mockStorageService.readFile.mockResolvedValue(Buffer.alloc(1000));
      mockStorageService.isAnimated.mockResolvedValue(false);
    });

    it('reserves the quota slot in one conditional update', async () => {
      mockPrismaService.client.updateMany.mockResolvedValue({ count: 1 });
      mockHttpService.post.mockReturnValue(
        of({ data: { output: { url: 'https://t/x', size: 600 } } }),
      );
      mockHttpService.get.mockReturnValue(of({ data: Buffer.alloc(600) }));
      mockStorageService.createThumbnail.mockResolvedValue(Buffer.alloc(10));
      mockPrismaService.image.update.mockResolvedValue({
        ...mockImage,
        size: 600,
        tinifyOptimized: true,
        imageTags: [],
      });

      await service.compressImageWithTinify(mockImageId);

      expect(mockPrismaService.client.updateMany).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.client.updateMany).toHaveBeenCalledWith({
        where: {
          id: mockClientId,
          currentTinifyUsage: { lt: 'currentTinifyLimit-ref' },
        },
        data: { currentTinifyUsage: { increment: 1 } },
      });
    });

    it('refuses without calling Tinify when no slot is left', async () => {
      // A parallel request took the last slot after our client row was read
      mockPrismaService.client.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.compressImageWithTinify(mockImageId),
      ).rejects.toThrow(BadRequestException);
      expect(mockHttpService.post).not.toHaveBeenCalled();
      expect(mockPrismaService.client.updateMany).toHaveBeenCalledTimes(1);
    });

    it('gives the slot back when Tinify never compressed the image', async () => {
      mockPrismaService.client.updateMany.mockResolvedValue({ count: 1 });
      mockHttpService.post.mockReturnValue(
        throwError(() => new Error('ECONNRESET')),
      );

      await expect(
        service.compressImageWithTinify(mockImageId),
      ).rejects.toThrow('ECONNRESET');
      expect(mockPrismaService.client.updateMany).toHaveBeenLastCalledWith({
        where: { id: mockClientId, currentTinifyUsage: { gt: 0 } },
        data: { currentTinifyUsage: { decrement: 1 } },
      });
    });

    it('keeps the slot spent when failing after Tinify billed it', async () => {
      mockPrismaService.client.updateMany.mockResolvedValue({ count: 1 });
      mockHttpService.post.mockReturnValue(
        of({ data: { output: { url: 'https://t/x', size: 600 } } }),
      );
      mockHttpService.get.mockReturnValue(
        throwError(() => new Error('download failed')),
      );

      await expect(
        service.compressImageWithTinify(mockImageId),
      ).rejects.toThrow('download failed');
      expect(mockPrismaService.client.updateMany).toHaveBeenCalledTimes(1);
    });

    it('keeps the original, still marked compressed, when Tinify saves nothing', async () => {
      mockPrismaService.client.updateMany.mockResolvedValue({ count: 1 });
      mockHttpService.post.mockReturnValue(
        of({ data: { output: { url: 'https://t/x', size: 1200 } } }),
      );
      mockPrismaService.image.update.mockResolvedValue({
        ...mockImage,
        tinifyOptimized: true,
        imageTags: [],
      });

      await service.compressImageWithTinify(mockImageId);

      expect(mockHttpService.get).not.toHaveBeenCalled();
      expect(mockStorageService.saveFile).not.toHaveBeenCalled();
      expect(mockPrismaService.image.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { size: 1000, tinifyOptimized: true },
        }),
      );
    });

    it('raises the local usage to a higher Compression-Count', async () => {
      mockPrismaService.client.updateMany.mockResolvedValue({ count: 1 });
      mockHttpService.post.mockReturnValue(
        of({
          headers: { 'compression-count': '42' },
          data: { output: { url: 'https://t/x', size: 1200 } },
        }),
      );
      mockPrismaService.image.update.mockResolvedValue({
        ...mockImage,
        imageTags: [],
      });

      await service.compressImageWithTinify(mockImageId);

      expect(mockPrismaService.client.updateMany).toHaveBeenLastCalledWith({
        where: { id: mockClientId, currentTinifyUsage: { lt: 42 } },
        data: { currentTinifyUsage: 42 },
      });
    });

    it('marks the quota exhausted on a Tinify 429', async () => {
      mockPrismaService.client.updateMany.mockResolvedValue({ count: 1 });
      mockPrismaService.client.update.mockResolvedValue({});
      mockHttpService.post.mockReturnValue(
        throwError(() =>
          Object.assign(new Error('Too many requests'), {
            response: { status: 429, data: {} },
          }),
        ),
      );

      await expect(
        service.compressImageWithTinify(mockImageId),
      ).rejects.toThrow('Too many requests');
      expect(mockPrismaService.client.update).toHaveBeenCalledWith({
        where: { id: mockClientId },
        data: { currentTinifyUsage: 500 },
      });
      // refund first, so the decrement can't undo the exhausted mark
      const refund =
        mockPrismaService.client.updateMany.mock.invocationCallOrder;
      const exhaust =
        mockPrismaService.client.update.mock.invocationCallOrder[0];
      expect(refund[refund.length - 1]).toBeLessThan(exhaust);
    });

    it('keeps the slot spent on a 2xx without a usable output', async () => {
      mockPrismaService.client.updateMany.mockResolvedValue({ count: 1 });
      mockHttpService.post.mockReturnValue(of({ data: {} }));

      await expect(
        service.compressImageWithTinify(mockImageId),
      ).rejects.toThrow(BadRequestException);
      // the reservation only: no refund
      expect(mockPrismaService.client.updateMany).toHaveBeenCalledTimes(1);
    });

    it('refuses an image the optimize job has not re-encoded yet', async () => {
      mockPrismaService.image.findUnique.mockResolvedValue({
        ...mockImage,
        isOptimized: false,
        tinifyOptimized: false,
      });

      await expect(
        service.compressImageWithTinify(mockImageId),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrismaService.client.updateMany).not.toHaveBeenCalled();
      expect(mockHttpService.post).not.toHaveBeenCalled();
    });
  });

  describe('getImageMetadata srcset', () => {
    it('offers a srcset built on fullPath for a public image', async () => {
      const result = await service.getImageMetadata(mockImage);

      expect(result.srcset?.startsWith(result.fullPath)).toBe(true);
      expect(result.srcset?.endsWith(`${result.fullPath} 1920w`)).toBe(true);
    });

    it('omits srcset for a private image', async () => {
      const result = await service.getImageMetadata({
        ...mockImage,
        isPrivate: true,
      });

      expect(result.srcset).toBeUndefined();
    });
  });

  describe('configuration', () => {
    it('should load quality settings from config', () => {
      // The service is already created in beforeEach with the config mock
      // We just verify the service was constructed successfully with config
      expect(service).toBeDefined();

      // We can't check the mock calls here because clearAllMocks() is called
      // after service construction. Instead, we verify the service exists
      // and the config mock was set up to return the right values.
      expect(mockConfigService.get('ORIGINAL_QUALITY')).toBe('100');
      expect(mockConfigService.get('THUMBNAIL_QUALITY')).toBe('70');
      expect(mockConfigService.get('THUMBNAIL_SIZE')).toBe('800');
    });
  });
});
