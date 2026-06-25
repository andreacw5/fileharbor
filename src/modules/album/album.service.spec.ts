import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { AlbumResourceType } from '@prisma/client';
import { AlbumService } from './album.service';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { WebhookService } from '@/modules/webhook/webhook.service';
import { RouteHelperService } from '@/utils/route.utils';
import { CreateAlbumDto, UpdateAlbumDto } from './dto';

describe('AlbumService', () => {
  let service: AlbumService;

  const mockClientId = 'client-123';
  const mockUserId = 'user-123';
  const mockAlbumId = 'album-123';
  const mockImageId = 'image-123';
  const mockVideoId = 'video-123';
  const mockToken = '550e8400-e29b-41d4-a716-446655440000';

  const mockAlbum = {
    id: mockAlbumId,
    clientId: mockClientId,
    userId: mockUserId,
    externalAlbumId: 'ext-album-123',
    name: 'Test Album',
    description: 'Test Description',
    isPublic: false,
    coverImageId: null,
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
    mimeType: 'image/jpeg',
    format: 'jpeg',
    width: 1920,
    height: 1080,
    size: 1024000,
    createdAt: new Date('2024-01-01'),
  };

  const mockVideo = {
    id: mockVideoId,
    clientId: mockClientId,
    userId: mockUserId,
    originalName: 'test.mp4',
    mimeType: 'video/mp4',
    duration: 120,
    width: 1920,
    height: 1080,
    size: 5000000,
    createdAt: new Date('2024-01-01'),
  };

  const mockAlbumItem = {
    id: 'album-item-123',
    albumId: mockAlbumId,
    imageId: mockImageId,
    videoId: null,
    resourceType: AlbumResourceType.IMAGE,
    order: 0,
    addedAt: new Date('2024-01-01'),
    image: { id: mockImageId },
  };

  const mockAlbumWithItems = {
    ...mockAlbum,
    albumItems: [mockAlbumItem],
    _count: { albumItems: 1 },
  };

  const mockPublicAlbumWithItems = {
    ...mockPublicAlbum,
    albumItems: [mockAlbumItem],
    _count: { albumItems: 1 },
  };

  const mockAlbumToken = {
    id: 'token-123',
    albumId: mockAlbumId,
    token: mockToken,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date('2024-01-01'),
  };

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
    albumItem: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    albumToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
    image: {
      findFirst: jest.fn(),
    },
    video: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockWebhookService = {
    sendWebhook: jest.fn().mockResolvedValue(undefined),
  };

  const mockRouteService = {
    fullUrl: jest.fn((...segments: string[]) => `http://localhost:3000/v2/${segments.join('/')}`),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlbumService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: RouteHelperService, useValue: mockRouteService },
      ],
    }).compile();

    service = module.get<AlbumService>(AlbumService);
    jest.clearAllMocks();
    mockWebhookService.sendWebhook.mockResolvedValue(undefined);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------

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
        coverImageId: mockAlbum.coverImageId,
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
      const createDto: CreateAlbumDto = { name: 'Public Album', isPublic: true };
      mockPrismaService.album.create.mockResolvedValue(mockPublicAlbum);

      await service.createAlbum(mockClientId, mockUserId, createDto);

      expect(mockPrismaService.album.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isPublic: true }) }),
      );
    });

    it('should create album with externalAlbumId when provided', async () => {
      const createDto: CreateAlbumDto = { externalAlbumId: 'ext-album-456', name: 'External Album' };
      mockPrismaService.album.create.mockResolvedValue({ ...mockAlbum, externalAlbumId: 'ext-album-456' });

      await service.createAlbum(mockClientId, mockUserId, createDto);

      expect(mockPrismaService.album.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ externalAlbumId: 'ext-album-456' }) }),
      );
    });
  });

  // ---------------------------------------------------------------------------

  describe('getAlbumById', () => {
    it('should return album when found', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithItems);

      const result = await service.getAlbumById(mockAlbumId, mockClientId);

      expect(result).toEqual(mockAlbumWithItems);
      expect(mockPrismaService.album.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: mockAlbumId, clientId: mockClientId } }),
      );
    });

    it('should throw NotFoundException when album not found', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(null);

      await expect(service.getAlbumById('non-existent', mockClientId)).rejects.toThrow(NotFoundException);
      await expect(service.getAlbumById('non-existent', mockClientId)).rejects.toThrow('Album not found');
    });
  });

  // ---------------------------------------------------------------------------

  describe('getAlbumWithItems', () => {
    it('should return public album for any user', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockPublicAlbumWithItems);

      const result = await service.getAlbumWithItems(mockPublicAlbum.id, mockClientId, 'different-user');

      expect(result.itemCount).toBe(1);
      expect(result.isPublic).toBe(true);
    });

    it('should return private album for owner', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithItems);

      const result = await service.getAlbumWithItems(mockAlbumId, mockClientId, mockUserId);

      expect(result.itemCount).toBe(1);
    });

    it('should throw ForbiddenException when accessing private album without permission', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithItems);

      await expect(
        service.getAlbumWithItems(mockAlbumId, mockClientId, 'different-user'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.getAlbumWithItems(mockAlbumId, mockClientId, 'different-user'),
      ).rejects.toThrow('Access denied to private album');
    });
  });

  // ---------------------------------------------------------------------------

  describe('getUserAlbums', () => {
    it('should return all albums for a user', async () => {
      const albums = [mockAlbumWithItems, { ...mockAlbumWithItems, id: 'album-456' }];
      mockPrismaService.album.findMany.mockResolvedValue(albums);

      const result = await service.getUserAlbums(mockClientId, mockUserId);

      expect(result).toHaveLength(2);
      expect(result[0].itemCount).toBe(1);
    });

    it('should return empty array when user has no albums', async () => {
      mockPrismaService.album.findMany.mockResolvedValue([]);

      const result = await service.getUserAlbums(mockClientId, mockUserId);

      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------

  describe('listAlbums', () => {
    it('should list albums with pagination', async () => {
      mockPrismaService.album.findMany.mockResolvedValue([mockAlbumWithItems]);
      mockPrismaService.album.count.mockResolvedValue(1);

      const result = await service.listAlbums({ clientId: mockClientId, page: 1, perPage: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.perPage).toBe(20);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.totalPages).toBe(1);
    });

    it('should filter albums by public status', async () => {
      mockPrismaService.album.findMany.mockResolvedValue([{ ...mockPublicAlbumWithItems }]);
      mockPrismaService.album.count.mockResolvedValue(1);

      await service.listAlbums({ clientId: mockClientId, public: true });

      expect(mockPrismaService.album.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isPublic: true }) }),
      );
    });

    it('should filter albums by search term', async () => {
      mockPrismaService.album.findMany.mockResolvedValue([{ ...mockAlbumWithItems }]);
      mockPrismaService.album.count.mockResolvedValue(1);

      await service.listAlbums({ clientId: mockClientId, search: 'Test' });

      expect(mockPrismaService.album.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ name: { contains: 'Test', mode: 'insensitive' } }),
        }),
      );
    });

    it('should limit perPage to maximum 100', async () => {
      mockPrismaService.album.findMany.mockResolvedValue([]);
      mockPrismaService.album.count.mockResolvedValue(0);

      await service.listAlbums({ clientId: mockClientId, perPage: 200 });

      expect(mockPrismaService.album.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });

  // ---------------------------------------------------------------------------

  describe('updateAlbum', () => {
    it('should update album when user is owner', async () => {
      const updateDto: UpdateAlbumDto = { name: 'Updated Album', description: 'Updated Description' };

      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithItems);
      mockPrismaService.album.update.mockResolvedValue({ ...mockAlbum, ...updateDto });

      const result = await service.updateAlbum(mockAlbumId, mockClientId, mockUserId, updateDto);

      expect(result.name).toBe('Updated Album');
      expect(result.description).toBe('Updated Description');
      expect(mockWebhookService.sendWebhook).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when user is not owner', async () => {
      const updateDto: UpdateAlbumDto = { name: 'Updated Album' };

      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithItems);

      await expect(
        service.updateAlbum(mockAlbumId, mockClientId, 'different-user', updateDto),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.updateAlbum(mockAlbumId, mockClientId, 'different-user', updateDto),
      ).rejects.toThrow('You can only update your own albums');
    });
  });

  // ---------------------------------------------------------------------------

  describe('deleteAlbum', () => {
    it('should delete album when user is owner', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithItems);
      mockPrismaService.album.delete.mockResolvedValue(mockAlbum);

      const result = await service.deleteAlbum(mockAlbumId, mockClientId, mockUserId);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Album deleted successfully');
      expect(mockPrismaService.album.delete).toHaveBeenCalledWith({ where: { id: mockAlbumId } });
      expect(mockWebhookService.sendWebhook).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when user is not owner', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithItems);

      await expect(
        service.deleteAlbum(mockAlbumId, mockClientId, 'different-user'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.deleteAlbum(mockAlbumId, mockClientId, 'different-user'),
      ).rejects.toThrow('You can only delete your own albums');
    });
  });

  // ---------------------------------------------------------------------------

  describe('addItemsToAlbum', () => {
    const mockUpsertResult = { id: 'album-item-123', resourceType: AlbumResourceType.IMAGE, order: 0 };

    it('should add an image to album', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbum);
      mockPrismaService.albumItem.findFirst.mockResolvedValue(null);
      mockPrismaService.image.findFirst.mockResolvedValue(mockImage);
      mockPrismaService.albumItem.upsert.mockResolvedValue(mockUpsertResult);

      const result = await service.addItemsToAlbum(
        mockAlbumId,
        mockClientId,
        [{ id: mockImageId, resourceType: AlbumResourceType.IMAGE }],
        { userId: mockUserId },
      );

      expect(result.albumId).toBe(mockAlbumId);
      expect(result.count).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(mockPrismaService.albumItem.upsert).toHaveBeenCalledTimes(1);
    });

    it('should add a video to album', async () => {
      const mockVideoUpsertResult = { id: 'album-item-456', resourceType: AlbumResourceType.VIDEO, order: 0 };
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbum);
      mockPrismaService.albumItem.findFirst.mockResolvedValue(null);
      mockPrismaService.video.findFirst.mockResolvedValue(mockVideo);
      mockPrismaService.albumItem.upsert.mockResolvedValue(mockVideoUpsertResult);

      const result = await service.addItemsToAlbum(
        mockAlbumId,
        mockClientId,
        [{ id: mockVideoId, resourceType: AlbumResourceType.VIDEO }],
        { userId: mockUserId },
      );

      expect(result.count).toBe(1);
      expect(result.items[0].resourceType).toBe(AlbumResourceType.VIDEO);
    });

    it('should throw ForbiddenException when user is not owner', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbum);

      await expect(
        service.addItemsToAlbum(
          mockAlbumId,
          mockClientId,
          [{ id: mockImageId, resourceType: AlbumResourceType.IMAGE }],
          { userId: 'different-user' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when image not found or unauthorized', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbum);
      mockPrismaService.albumItem.findFirst.mockResolvedValue(null);
      mockPrismaService.image.findFirst.mockResolvedValue(null);

      await expect(
        service.addItemsToAlbum(
          mockAlbumId,
          mockClientId,
          [{ id: 'nonexistent-image', resourceType: AlbumResourceType.IMAGE }],
          { userId: mockUserId },
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should bypass ownership check with force option', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbum);
      mockPrismaService.albumItem.findFirst.mockResolvedValue(null);
      mockPrismaService.image.findFirst.mockResolvedValue(mockImage);
      mockPrismaService.albumItem.upsert.mockResolvedValue(mockUpsertResult);

      const result = await service.addItemsToAlbum(
        mockAlbumId,
        mockClientId,
        [{ id: mockImageId, resourceType: AlbumResourceType.IMAGE }],
        { force: true },
      );

      expect(result.count).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------

  describe('removeItemsFromAlbum', () => {
    it('should remove an image from album', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbum);
      mockPrismaService.albumItem.delete.mockResolvedValue(mockAlbumItem);

      const result = await service.removeItemsFromAlbum(
        mockAlbumId,
        mockClientId,
        [{ id: mockImageId, resourceType: AlbumResourceType.IMAGE }],
        { userId: mockUserId },
      );

      expect(result.success).toBe(true);
      expect(result.removed).toBe(1);
      expect(mockPrismaService.albumItem.delete).toHaveBeenCalledWith({
        where: { albumId_imageId: { albumId: mockAlbumId, imageId: mockImageId } },
      });
    });

    it('should remove a video from album', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbum);
      mockPrismaService.albumItem.delete.mockResolvedValue({ ...mockAlbumItem, videoId: mockVideoId, imageId: null });

      const result = await service.removeItemsFromAlbum(
        mockAlbumId,
        mockClientId,
        [{ id: mockVideoId, resourceType: AlbumResourceType.VIDEO }],
        { userId: mockUserId },
      );

      expect(result.removed).toBe(1);
      expect(mockPrismaService.albumItem.delete).toHaveBeenCalledWith({
        where: { albumId_videoId: { albumId: mockAlbumId, videoId: mockVideoId } },
      });
    });

    it('should throw ForbiddenException when user is not owner', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbum);

      await expect(
        service.removeItemsFromAlbum(
          mockAlbumId,
          mockClientId,
          [{ id: mockImageId, resourceType: AlbumResourceType.IMAGE }],
          { userId: 'different-user' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should silently skip items not found (no throw)', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbum);
      mockPrismaService.albumItem.delete.mockRejectedValue(new Error('Record not found'));

      const result = await service.removeItemsFromAlbum(
        mockAlbumId,
        mockClientId,
        [{ id: 'nonexistent', resourceType: AlbumResourceType.IMAGE }],
        { userId: mockUserId },
      );

      expect(result.removed).toBe(0);
      expect(result.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------

  describe('generateAlbumToken', () => {
    it('should generate token for album owner', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithItems);
      mockPrismaService.albumToken.create.mockResolvedValue(mockAlbumToken);

      const result = await service.generateAlbumToken(mockAlbumId, mockClientId, mockUserId, 7);

      expect(result.token).toBeDefined();
      expect(result.albumId).toBe(mockAlbumId);
      expect(result.expiresAt).toBeDefined();
      expect(result.url).toContain('/v2/albums/shared/');
    });

    it('should generate token without expiration when expiresInDays not provided', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithItems);
      mockPrismaService.albumToken.create.mockImplementation((params) =>
        Promise.resolve({ ...mockAlbumToken, token: params.data.token, expiresAt: params.data.expiresAt }),
      );

      await service.generateAlbumToken(mockAlbumId, mockClientId, mockUserId);

      expect(mockPrismaService.albumToken.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ expiresAt: null }) }),
      );
    });

    it('should throw ForbiddenException when user is not owner', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithItems);

      await expect(
        service.generateAlbumToken(mockAlbumId, mockClientId, 'different-user', 7),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ---------------------------------------------------------------------------

  describe('validateAlbumToken', () => {
    it('should validate valid token', async () => {
      mockPrismaService.albumToken.findUnique.mockResolvedValue(mockAlbumToken);

      const result = await service.validateAlbumToken(mockAlbumId, mockToken);

      expect(result).toBe(true);
    });

    it('should throw ForbiddenException for invalid token', async () => {
      mockPrismaService.albumToken.findUnique.mockResolvedValue(null);

      await expect(service.validateAlbumToken(mockAlbumId, 'invalid-token')).rejects.toThrow(ForbiddenException);
      await expect(service.validateAlbumToken(mockAlbumId, 'invalid-token')).rejects.toThrow('Invalid token');
    });

    it('should throw ForbiddenException for token with wrong albumId', async () => {
      mockPrismaService.albumToken.findUnique.mockResolvedValue(mockAlbumToken);

      await expect(service.validateAlbumToken('wrong-album-id', mockToken)).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException for expired token', async () => {
      const expiredToken = { ...mockAlbumToken, expiresAt: new Date(Date.now() - 1000) };
      mockPrismaService.albumToken.findUnique.mockResolvedValue(expiredToken);

      await expect(service.validateAlbumToken(mockAlbumId, mockToken)).rejects.toThrow(ForbiddenException);
      await expect(service.validateAlbumToken(mockAlbumId, mockToken)).rejects.toThrow('Token expired');
    });
  });

  // ---------------------------------------------------------------------------

  describe('getAlbumBySharedToken', () => {
    it('should return album for valid token', async () => {
      const albumWithItems = {
        ...mockAlbum,
        albumItems: [{ image: { id: mockImageId } }],
        _count: { albumItems: 1 },
      };

      mockPrismaService.albumToken.findUnique.mockResolvedValue(mockAlbumToken);
      mockPrismaService.album.findUnique.mockResolvedValue(albumWithItems);

      const result = await service.getAlbumBySharedToken(mockToken);

      expect(result.id).toBe(mockAlbumId);
      expect(result.itemCount).toBe(1);
      expect(result.coverUrl).toBe(`http://localhost:3000/v2/images/${mockImageId}`);
    });

    it('should throw ForbiddenException for invalid token', async () => {
      mockPrismaService.albumToken.findUnique.mockResolvedValue(null);

      await expect(service.getAlbumBySharedToken('invalid-token')).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when album not found', async () => {
      mockPrismaService.albumToken.findUnique.mockResolvedValue(mockAlbumToken);
      mockPrismaService.album.findUnique.mockResolvedValue(null);

      await expect(service.getAlbumBySharedToken(mockToken)).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------

  describe('revokeAlbumToken', () => {
    it('should revoke all tokens for album', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithItems);
      mockPrismaService.albumToken.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.revokeAlbumToken(mockAlbumId, mockClientId, mockUserId);

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(mockPrismaService.albumToken.deleteMany).toHaveBeenCalledWith({ where: { albumId: mockAlbumId } });
    });

    it('should throw ForbiddenException when user is not owner', async () => {
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbumWithItems);

      await expect(
        service.revokeAlbumToken(mockAlbumId, mockClientId, 'different-user'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ---------------------------------------------------------------------------

  describe('deleteExpiredAlbumTokens', () => {
    it('should delete all expired tokens', async () => {
      mockPrismaService.albumToken.deleteMany.mockResolvedValue({ count: 5 });

      const result = await service.deleteExpiredAlbumTokens();

      expect(result).toBe(5);
      expect(mockPrismaService.albumToken.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });
    });
  });

  // ---------------------------------------------------------------------------

  describe('getAlbumByExternalId', () => {
    it('should return album by external ID', async () => {
      mockPrismaService.album.findUnique.mockResolvedValue(mockAlbumWithItems);

      const result = await service.getAlbumByExternalId('ext-album-123', mockClientId);

      expect(result).toEqual(mockAlbumWithItems);
      expect(mockPrismaService.album.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clientId_externalAlbumId: { clientId: mockClientId, externalAlbumId: 'ext-album-123' } },
        }),
      );
    });

    it('should throw NotFoundException when album not found', async () => {
      mockPrismaService.album.findUnique.mockResolvedValue(null);

      await expect(service.getAlbumByExternalId('non-existent', mockClientId)).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------

  describe('getAlbumWithItemsByExternalId', () => {
    it('should return public album by external ID for any user', async () => {
      mockPrismaService.album.findUnique.mockResolvedValue(mockPublicAlbumWithItems);

      const result = await service.getAlbumWithItemsByExternalId('ext-album-123', mockClientId, 'any-user');

      expect(result.isPublic).toBe(true);
      expect(result.itemCount).toBe(1);
    });

    it('should throw ForbiddenException for private album without permission', async () => {
      mockPrismaService.album.findUnique.mockResolvedValue(mockAlbumWithItems);

      await expect(
        service.getAlbumWithItemsByExternalId('ext-album-123', mockClientId, 'different-user'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ---------------------------------------------------------------------------

  describe('updateAlbumByExternalId', () => {
    it('should update album by external ID', async () => {
      const updateDto: UpdateAlbumDto = { name: 'Updated Name' };

      mockPrismaService.album.findUnique.mockResolvedValue(mockAlbumWithItems);
      mockPrismaService.album.update.mockResolvedValue({ ...mockAlbum, name: 'Updated Name' });

      const result = await service.updateAlbumByExternalId('ext-album-123', mockClientId, mockUserId, updateDto);

      expect(result.name).toBe('Updated Name');
      expect(mockWebhookService.sendWebhook).toHaveBeenCalled();
    });

    it('should throw ForbiddenException when user is not owner', async () => {
      mockPrismaService.album.findUnique.mockResolvedValue(mockAlbumWithItems);

      await expect(
        service.updateAlbumByExternalId('ext-album-123', mockClientId, 'different-user', {}),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ---------------------------------------------------------------------------

  describe('addItemsToAlbumByExternalId', () => {
    it('should add items to album by external ID', async () => {
      const mockUpsertResult = { id: 'album-item-123', resourceType: AlbumResourceType.IMAGE, order: 0 };

      mockPrismaService.album.findUnique.mockResolvedValue(mockAlbumWithItems);
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbum);
      mockPrismaService.albumItem.findFirst.mockResolvedValue(null);
      mockPrismaService.image.findFirst.mockResolvedValue(mockImage);
      mockPrismaService.albumItem.upsert.mockResolvedValue(mockUpsertResult);

      const result = await service.addItemsToAlbumByExternalId(
        'ext-album-123',
        mockClientId,
        [{ id: mockImageId, resourceType: AlbumResourceType.IMAGE }],
        { userId: mockUserId },
      );

      expect(result.albumId).toBe(mockAlbumId);
      expect(result.count).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------

  describe('removeItemsFromAlbumByExternalId', () => {
    it('should remove items from album by external ID', async () => {
      mockPrismaService.album.findUnique.mockResolvedValue(mockAlbumWithItems);
      mockPrismaService.album.findFirst.mockResolvedValue(mockAlbum);
      mockPrismaService.albumItem.delete.mockResolvedValue(mockAlbumItem);

      const result = await service.removeItemsFromAlbumByExternalId(
        'ext-album-123',
        mockClientId,
        [{ id: mockImageId, resourceType: AlbumResourceType.IMAGE }],
        { userId: mockUserId },
      );

      expect(result.success).toBe(true);
      expect(result.removed).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------

  describe('formatAlbumResponse (via createAlbum)', () => {
    it('should include expected fields and exclude updatedAt', async () => {
      mockPrismaService.album.create.mockResolvedValue(mockAlbum);

      const result = await service.createAlbum(mockClientId, mockUserId, { name: 'Test' });

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
