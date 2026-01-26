import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { AlbumService } from './album.service';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { WebhookService } from '@/modules/webhook/webhook.service';
import { CreateAlbumDto, UpdateAlbumDto } from './dto';

describe('AlbumService', () => {
  let service: AlbumService;
  let prismaService: PrismaService;
  let webhookService: WebhookService;

  // Mock data
  const mockClientId = 'client-123';
  const mockUserId = 'user-123';
  const mockAlbumId = 'album-123';
  const mockImageId = 'image-123';
  const mockToken = '550e8400-e29b-41d4-a716-446655440000';

  const mockAlbum = {
    id: mockAlbumId,
    clientId: mockClientId,
    userId: mockUserId,
    externalAlbumId: 'ext-album-123',
    name: 'Test Album',
    description: 'Test Description',
    isPublic: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const mockPublicAlbum = {
    ...mockAlbum,
    id: 'album-public-123',
    isPublic: true,
  };

  const mockImage = {
    id: mockImageId,
    clientId: mockClientId,
    userId: mockUserId,
    originalName: 'test.jpg',
    format: 'jpeg',
    width: 1920,
    height: 1080,
    size: 1024000,
    createdAt: new Date('2024-01-01'),
  };

  const mockAlbumImage = {
    albumId: mockAlbumId,
    imageId: mockImageId,
    order: 1,
    image: mockImage,
  };

  const mockAlbumWithImages = {
    ...mockAlbum,
    albumImages: [mockAlbumImage],
    _count: { albumImages: 1 },
  };

  const mockAlbumToken = {
    id: 'token-123',
    albumId: mockAlbumId,
    token: mockToken,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
    createdAt: new Date('2024-01-01'),
  };

  // Mock PrismaService
  const mockPrismaService = {
    album: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    albumImage: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    albumToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
    image: {
      findMany: jest.fn(),
    },
  };

  // Mock WebhookService
  const mockWebhookService = {
    sendWebhook: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlbumService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: WebhookService,
          useValue: mockWebhookService,
        },
      ],
    }).compile();

    service = module.get<AlbumService>(AlbumService);
    prismaService = module.get<PrismaService>(PrismaService);
    webhookService = module.get<WebhookService>(WebhookService);

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createAlbum', () => {
    it('should create a new album', async () => {
      const createDto: CreateAlbumDto = {
        name: 'Test Album',
        description: 'Test Description',
        isPublic: false,
      };

      mockPrismaService.album.create.mockResolvedValue(mockAlbum);

      const result = await service.createAlbum(mockClientId, mockUserId, createDto);

      expect(result).toEqual({
        id: mockAlbum.id,
        externalAlbumId: mockAlbum.externalAlbumId,
        clientId: mockAlbum.clientId,
        userId: mockAlbum.userId,
        name: mockAlbum.name,
        description: mockAlbum.description,
        isPublic: mockAlbum.isPublic,
        createdAt: mockAlbum.createdAt,
      });

      expect(mockPrismaService.album.create).toHaveBeenCalledWith({
        data: {
          clientId: mockClientId,
          userId: mockUserId,
          externalAlbumId: undefined,
          name: createDto.name,
          description: createDto.description,
          isPublic: false,
        },
      });

      expect(mockWebhookService.sendWebhook).toHaveBeenCalled();
    });

    it('should create a public album when isPublic is true', async () => {
      const createDto: CreateAlbumDto = {
        name: 'Public Album',
        isPublic: true,
      };

      mockPrismaService.album.create.mockResolvedValue(mockPublicAlbum);

      await service.createAlbum(mockClientId, mockUserId, createDto);

      expect(mockPrismaService.album.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isPublic: true,
          }),
        }),
      );
    });

    it('should create album with externalAlbumId when provided', async () => {
      const createDto: CreateAlbumDto = {
        externalAlbumId: 'ext-album-456',
        name: 'External Album',
      };

      mockPrismaService.album.create.mockResolvedValue({
        ...mockAlbum,
        externalAlbumId: 'ext-album-456',
      });

      await service.createAlbum(mockClientId, mockUserId, createDto);

      expect(mockPrismaService.album.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            externalAlbumId: 'ext-album-456',
          }),
        }),
      );
    });
  });

  describe('getAlbumById', () => {
    it('should return album when found', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithImages);

      const result = await service.getAlbumById(mockAlbumId, mockClientId);

      expect(result).toEqual(mockAlbumWithImages);
      expect(mockPrismaService.album.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockAlbumId,
          clientId: mockClientId,
        },
        include: {
          albumImages: {
            include: {
              image: true,
            },
            orderBy: {
              order: 'asc',
            },
          },
        },
      });
    });

    it('should throw NotFoundException when album not found', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(null);

      await expect(service.getAlbumById('non-existent', mockClientId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getAlbumById('non-existent', mockClientId)).rejects.toThrow(
        'Album not found',
      );
    });
  });

  describe('getAlbumWithImages', () => {
    it('should return public album with images for any user', async () => {
      const publicAlbumWithImages = {
        ...mockPublicAlbum,
        albumImages: [mockAlbumImage],
      };

      mockPrismaService.album.findFirst.mockResolvedValue(publicAlbumWithImages);

      const result = await service.getAlbumWithImages(
        mockPublicAlbum.id,
        mockClientId,
        'different-user',
      );

      expect(result.images).toHaveLength(1);
      expect(result.imageCount).toBe(1);
      expect(result.isPublic).toBe(true);
    });

    it('should return private album with images for owner', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithImages);

      const result = await service.getAlbumWithImages(
        mockAlbumId,
        mockClientId,
        mockUserId,
      );

      expect(result.images).toHaveLength(1);
      expect(result.imageCount).toBe(1);
      expect(result.images[0].id).toBe(mockImageId);
    });

    it('should throw ForbiddenException when accessing private album without permission', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithImages);

      await expect(
        service.getAlbumWithImages(mockAlbumId, mockClientId, 'different-user'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.getAlbumWithImages(mockAlbumId, mockClientId, 'different-user'),
      ).rejects.toThrow('Access denied to private album');
    });
  });

  describe('getUserAlbums', () => {
    it('should return all albums for a user', async () => {
      const albums = [mockAlbumWithImages, { ...mockAlbumWithImages, id: 'album-456' }];
      mockPrismaService.album.findMany.mockResolvedValue(albums);

      const result = await service.getUserAlbums(mockClientId, mockUserId);

      expect(result).toHaveLength(2);
      expect(result[0].imageCount).toBe(1);
      expect(mockPrismaService.album.findMany).toHaveBeenCalledWith({
        where: {
          clientId: mockClientId,
          userId: mockUserId,
        },
        include: {
          _count: {
            select: { albumImages: true },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
    });

    it('should return empty array when user has no albums', async () => {
      mockPrismaService.album.findMany.mockResolvedValue([]);

      const result = await service.getUserAlbums(mockClientId, mockUserId);

      expect(result).toEqual([]);
    });
  });

  describe('listAlbums', () => {
    it('should list albums with pagination', async () => {
      const albums = [mockAlbumWithImages];
      mockPrismaService.album.findMany.mockResolvedValue(albums);
      mockPrismaService.album.count.mockResolvedValue(1);

      const result = await service.listAlbums({
        clientId: mockClientId,
        page: 1,
        perPage: 20,
      });

      expect(result.data).toHaveLength(1);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.perPage).toBe(20);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.totalPages).toBe(1);
    });

    it('should filter albums by public status', async () => {
      mockPrismaService.album.findMany.mockResolvedValue([
        { ...mockPublicAlbum, _count: { albumImages: 0 } },
      ]);
      mockPrismaService.album.count.mockResolvedValue(1);

      await service.listAlbums({
        clientId: mockClientId,
        public: true,
      });

      expect(mockPrismaService.album.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isPublic: true,
          }),
        }),
      );
    });

    it('should filter albums by search term', async () => {
      mockPrismaService.album.findMany.mockResolvedValue([
        { ...mockAlbum, _count: { albumImages: 0 } },
      ]);
      mockPrismaService.album.count.mockResolvedValue(1);

      await service.listAlbums({
        clientId: mockClientId,
        search: 'Test',
      });

      expect(mockPrismaService.album.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            name: {
              contains: 'Test',
              mode: 'insensitive',
            },
          }),
        }),
      );
    });

    it('should limit perPage to maximum 100', async () => {
      mockPrismaService.album.findMany.mockResolvedValue([]);
      mockPrismaService.album.count.mockResolvedValue(0);

      await service.listAlbums({
        clientId: mockClientId,
        perPage: 200,
      });

      expect(mockPrismaService.album.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100,
        }),
      );
    });
  });

  describe('updateAlbum', () => {
    it('should update album when user is owner', async () => {
      const updateDto: UpdateAlbumDto = {
        name: 'Updated Album',
        description: 'Updated Description',
      };

      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithImages);
      mockPrismaService.album.update.mockResolvedValue({
        ...mockAlbum,
        ...updateDto,
      });

      const result = await service.updateAlbum(
        mockAlbumId,
        mockClientId,
        mockUserId,
        updateDto,
      );

      expect(result.name).toBe('Updated Album');
      expect(result.description).toBe('Updated Description');
      expect(mockWebhookService.sendWebhook).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when user is not owner', async () => {
      const updateDto: UpdateAlbumDto = {
        name: 'Updated Album',
      };

      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithImages);

      await expect(
        service.updateAlbum(mockAlbumId, mockClientId, 'different-user', updateDto),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.updateAlbum(mockAlbumId, mockClientId, 'different-user', updateDto),
      ).rejects.toThrow('You can only update your own albums');
    });
  });

  describe('deleteAlbum', () => {
    it('should delete album when user is owner', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithImages);
      mockPrismaService.album.delete.mockResolvedValue(mockAlbum);

      const result = await service.deleteAlbum(mockAlbumId, mockClientId, mockUserId);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Album deleted successfully');
      expect(mockPrismaService.album.delete).toHaveBeenCalledWith({
        where: { id: mockAlbumId },
      });
      expect(mockWebhookService.sendWebhook).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when user is not owner', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithImages);

      await expect(
        service.deleteAlbum(mockAlbumId, mockClientId, 'different-user'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.deleteAlbum(mockAlbumId, mockClientId, 'different-user'),
      ).rejects.toThrow('You can only delete your own albums');
    });
  });

  describe('addImagesToAlbum', () => {
    it('should add images to album', async () => {
      const imageIds = [mockImageId, 'image-456'];

      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithImages);
      mockPrismaService.image.findMany.mockResolvedValue([
        mockImage,
        { ...mockImage, id: 'image-456' },
      ]);
      mockPrismaService.albumImage.findFirst.mockResolvedValue({ order: 1 });
      mockPrismaService.albumImage.upsert.mockImplementation((params) =>
        Promise.resolve({
          albumId: mockAlbumId,
          imageId: params.create.imageId,
          order: params.create.order,
        }),
      );

      const result = await service.addImagesToAlbum(
        mockAlbumId,
        mockClientId,
        mockUserId,
        imageIds,
      );

      expect(result.albumId).toBe(mockAlbumId);
      expect(result.images).toHaveLength(2);
      expect(mockPrismaService.albumImage.upsert).toHaveBeenCalledTimes(2);
    });

    it('should throw ForbiddenException when user is not owner', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithImages);

      await expect(
        service.addImagesToAlbum(mockAlbumId, mockClientId, 'different-user', [mockImageId]),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when some images not found', async () => {
      const imageIds = [mockImageId, 'image-456'];

      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithImages);
      mockPrismaService.image.findMany.mockResolvedValue([mockImage]); // Only 1 instead of 2

      await expect(
        service.addImagesToAlbum(mockAlbumId, mockClientId, mockUserId, imageIds),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.addImagesToAlbum(mockAlbumId, mockClientId, mockUserId, imageIds),
      ).rejects.toThrow('Some images not found or unauthorized');
    });
  });

  describe('removeImageFromAlbum', () => {
    it('should remove image from album', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithImages);
      mockPrismaService.albumImage.delete.mockResolvedValue(mockAlbumImage);

      const result = await service.removeImageFromAlbum(
        mockAlbumId,
        mockImageId,
        mockClientId,
        mockUserId,
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe('Image removed from album');
      expect(mockPrismaService.albumImage.delete).toHaveBeenCalledWith({
        where: {
          albumId_imageId: {
            albumId: mockAlbumId,
            imageId: mockImageId,
          },
        },
      });
    });

    it('should throw ForbiddenException when user is not owner', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithImages);

      await expect(
        service.removeImageFromAlbum(mockAlbumId, mockImageId, mockClientId, 'different-user'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('removeImagesFromAlbum', () => {
    it('should remove multiple images from album', async () => {
      const imageIds = [mockImageId, 'image-456'];

      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithImages);
      mockPrismaService.albumImage.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.removeImagesFromAlbum(
        mockAlbumId,
        mockClientId,
        mockUserId,
        imageIds,
      );

      expect(result.success).toBe(true);
      expect(result.removed).toBe(2);
      expect(mockPrismaService.albumImage.deleteMany).toHaveBeenCalledWith({
        where: {
          albumId: mockAlbumId,
          imageId: {
            in: imageIds,
          },
        },
      });
    });
  });

  describe('generateAlbumToken', () => {
    it('should generate token for album owner', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithImages);
      mockPrismaService.albumToken.create.mockResolvedValue(mockAlbumToken);

      const result = await service.generateAlbumToken(
        mockAlbumId,
        mockClientId,
        mockUserId,
        7,
      );

      expect(result.token).toBeDefined();
      expect(result.albumId).toBe(mockAlbumId);
      expect(result.expiresAt).toBeDefined();
      expect(result.url).toContain('/v2/albums/shared/');
    });

    it('should generate token without expiration when expiresInDays not provided', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithImages);
      mockPrismaService.albumToken.create.mockImplementation((params) =>
        Promise.resolve({
          ...mockAlbumToken,
          token: params.data.token,
          expiresAt: params.data.expiresAt,
        }),
      );

      await service.generateAlbumToken(mockAlbumId, mockClientId, mockUserId);

      expect(mockPrismaService.albumToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            expiresAt: null,
          }),
        }),
      );
    });

    it('should throw ForbiddenException when user is not owner', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithImages);

      await expect(
        service.generateAlbumToken(mockAlbumId, mockClientId, 'different-user', 7),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('validateAlbumToken', () => {
    it('should validate valid token', async () => {
      mockPrismaService.albumToken.findUnique.mockResolvedValue(mockAlbumToken);

      const result = await service.validateAlbumToken(mockAlbumId, mockToken);

      expect(result).toBe(true);
    });

    it('should throw ForbiddenException for invalid token', async () => {
      mockPrismaService.albumToken.findUnique.mockResolvedValue(null);

      await expect(service.validateAlbumToken(mockAlbumId, 'invalid-token')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.validateAlbumToken(mockAlbumId, 'invalid-token')).rejects.toThrow(
        'Invalid token',
      );
    });

    it('should throw ForbiddenException for token with wrong albumId', async () => {
      mockPrismaService.albumToken.findUnique.mockResolvedValue(mockAlbumToken);

      await expect(service.validateAlbumToken('wrong-album-id', mockToken)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException for expired token', async () => {
      const expiredToken = {
        ...mockAlbumToken,
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      };

      mockPrismaService.albumToken.findUnique.mockResolvedValue(expiredToken);

      await expect(service.validateAlbumToken(mockAlbumId, mockToken)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.validateAlbumToken(mockAlbumId, mockToken)).rejects.toThrow(
        'Token expired',
      );
    });
  });

  describe('getAlbumBySharedToken', () => {
    it('should return album with images for valid token', async () => {
      const albumWithImages = {
        ...mockAlbum,
        albumImages: [mockAlbumImage],
      };

      mockPrismaService.albumToken.findUnique.mockResolvedValue(mockAlbumToken);
      mockPrismaService.album.findUnique.mockResolvedValue(albumWithImages);

      const result = await service.getAlbumBySharedToken(mockToken);

      expect(result.id).toBe(mockAlbumId);
      expect(result.images).toHaveLength(1);
      expect(result.imageCount).toBe(1);
    });

    it('should throw ForbiddenException for invalid token', async () => {
      mockPrismaService.albumToken.findUnique.mockResolvedValue(null);

      await expect(service.getAlbumBySharedToken('invalid-token')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw NotFoundException when album not found', async () => {
      mockPrismaService.albumToken.findUnique.mockResolvedValue(mockAlbumToken);
      mockPrismaService.album.findUnique.mockResolvedValue(null);

      await expect(service.getAlbumBySharedToken(mockToken)).rejects.toThrow(NotFoundException);
    });
  });

  describe('revokeAlbumToken', () => {
    it('should revoke all tokens for album', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithImages);
      mockPrismaService.albumToken.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.revokeAlbumToken(mockAlbumId, mockClientId, mockUserId);

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(mockPrismaService.albumToken.deleteMany).toHaveBeenCalledWith({
        where: {
          albumId: mockAlbumId,
        },
      });
    });

    it('should throw ForbiddenException when user is not owner', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithImages);

      await expect(
        service.revokeAlbumToken(mockAlbumId, mockClientId, 'different-user'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deleteExpiredAlbumTokens', () => {
    it('should delete all expired tokens', async () => {
      mockPrismaService.albumToken.deleteMany.mockResolvedValue({ count: 5 });

      const result = await service.deleteExpiredAlbumTokens();

      expect(result).toBe(5);
      expect(mockPrismaService.albumToken.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: {
            lt: expect.any(Date),
          },
        },
      });
    });
  });

  describe('getAlbumByExternalId', () => {
    it('should return album by external ID', async () => {
      const externalAlbumId = 'ext-album-123';

      mockPrismaService.album.findUnique.mockResolvedValue(mockAlbumWithImages);

      const result = await service.getAlbumByExternalId(externalAlbumId, mockClientId);

      expect(result).toEqual(mockAlbumWithImages);
      expect(mockPrismaService.album.findUnique).toHaveBeenCalledWith({
        where: {
          clientId_externalAlbumId: {
            clientId: mockClientId,
            externalAlbumId,
          },
        },
        include: {
          albumImages: {
            include: {
              image: true,
            },
            orderBy: {
              order: 'asc',
            },
          },
        },
      });
    });

    it('should throw NotFoundException when album not found', async () => {
      mockPrismaService.album.findUnique.mockResolvedValue(null);

      await expect(
        service.getAlbumByExternalId('non-existent', mockClientId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getAlbumWithImagesByExternalId', () => {
    it('should return public album with images by external ID', async () => {
      const publicAlbumWithImages = {
        ...mockPublicAlbum,
        albumImages: [mockAlbumImage],
      };

      mockPrismaService.album.findUnique.mockResolvedValue(publicAlbumWithImages);

      const result = await service.getAlbumWithImagesByExternalId(
        'ext-album-123',
        mockClientId,
        'any-user',
      );

      expect(result.images).toHaveLength(1);
      expect(result.isPublic).toBe(true);
    });

    it('should throw ForbiddenException for private album without permission', async () => {
      mockPrismaService.album.findUnique.mockResolvedValue(mockAlbumWithImages);

      await expect(
        service.getAlbumWithImagesByExternalId('ext-album-123', mockClientId, 'different-user'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateAlbumByExternalId', () => {
    it('should update album by external ID', async () => {
      const updateDto: UpdateAlbumDto = {
        name: 'Updated Name',
      };

      mockPrismaService.album.findUnique.mockResolvedValue(mockAlbumWithImages);
      mockPrismaService.album.update.mockResolvedValue({
        ...mockAlbum,
        name: 'Updated Name',
      });

      const result = await service.updateAlbumByExternalId(
        'ext-album-123',
        mockClientId,
        mockUserId,
        updateDto,
      );

      expect(result.name).toBe('Updated Name');
      expect(mockWebhookService.sendWebhook).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when user is not owner', async () => {
      mockPrismaService.album.findUnique.mockResolvedValue(mockAlbumWithImages);

      await expect(
        service.updateAlbumByExternalId(
          'ext-album-123',
          mockClientId,
          'different-user',
          {},
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('addImagesToAlbumByExternalId', () => {
    it('should add images to album by external ID', async () => {
      const imageIds = [mockImageId];

      mockPrismaService.album.findUnique.mockResolvedValue(mockAlbumWithImages);
      mockPrismaService.image.findMany.mockResolvedValue([mockImage]);
      mockPrismaService.albumImage.findFirst.mockResolvedValue({ order: 1 });
      mockPrismaService.albumImage.upsert.mockResolvedValue({
        albumId: mockAlbumId,
        imageId: mockImageId,
        order: 2,
      });

      const result = await service.addImagesToAlbumByExternalId(
        'ext-album-123',
        mockClientId,
        mockUserId,
        imageIds,
      );

      expect(result.externalAlbumId).toBe('ext-album-123');
      expect(result.images).toHaveLength(1);
    });
  });

  describe('removeImagesFromAlbumByExternalId', () => {
    it('should remove images from album by external ID', async () => {
      const imageIds = [mockImageId];

      mockPrismaService.album.findUnique.mockResolvedValue(mockAlbumWithImages);
      mockPrismaService.albumImage.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.removeImagesFromAlbumByExternalId(
        'ext-album-123',
        mockClientId,
        mockUserId,
        imageIds,
      );

      expect(result.success).toBe(true);
      expect(result.removed).toBe(1);
    });
  });

  describe('formatAlbumResponse', () => {
    it('should format album response correctly', async () => {
      mockPrismaService.album.create.mockResolvedValue(mockAlbum);

      const result = await service.createAlbum(mockClientId, mockUserId, {
        name: 'Test',
      });

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('externalAlbumId');
      expect(result).toHaveProperty('clientId');
      expect(result).toHaveProperty('userId');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('isPublic');
      expect(result).toHaveProperty('createdAt');
      expect(result).not.toHaveProperty('updatedAt');
    });
  });
});
