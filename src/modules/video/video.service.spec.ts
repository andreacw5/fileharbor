import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import * as fsPromises from 'fs/promises';
import { VideoService } from './video.service';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { StorageService } from '@/modules/storage/storage.service';
import { ConfigService } from '@nestjs/config';
import { WebhookService, WebhookEvent } from '@/modules/webhook/webhook.service';
import { UserService } from '@/modules/user/user.service';
import { RouteHelperService } from '@/utils/route.utils';

jest.mock('fs/promises');

describe('VideoService', () => {
  let service: VideoService;

  const mockClientId = 'client-123';
  const mockUserId = 'user-123';
  const mockExternalUserId = 'ext-user-123';
  const mockVideoId = 'video-123';
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

  const mockUser = {
    id: mockUserId,
    clientId: mockClientId,
    externalUserId: mockExternalUserId,
    email: null,
    username: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockSystemUser = {
    id: 'system-user-id',
    clientId: mockClientId,
    externalUserId: 'system',
    email: null,
    username: 'system',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockVideo = {
    id: mockVideoId,
    clientId: mockClientId,
    userId: mockUserId,
    originalName: 'test.mp4',
    storagePath: `${mockDomain}/videos/${mockVideoId}`,
    mimeType: 'video/mp4',
    size: 10485760,
    duration: 120,
    width: 1920,
    height: 1080,
    isPrivate: false,
    views: 0,
    downloads: 0,
    description: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    videoTags: [],
    user: { id: mockUserId, externalUserId: mockExternalUserId, username: null },
    client: { id: mockClientId, name: 'Test Client', domain: mockDomain },
  };

  // MP4 magic: bytes 4-7 must be 'ftyp' (0x66 0x74 0x79 0x70)
  const mockMp4Magic = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]);

  const mockFile: Express.Multer.File = {
    fieldname: 'file',
    originalname: 'test.mp4',
    encoding: '7bit',
    mimetype: 'video/mp4',
    size: 10485760,
    buffer: null,
    stream: null,
    destination: '/tmp',
    filename: 'test.mp4',
    path: '/tmp/test-upload.mp4',
  };

  const mockPrismaService = {
    client: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    video: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockStorageService = {
    getVideoFilePath: jest.fn(),
    getVideoPath: jest.fn(),
    copyFromTemp: jest.fn(),
    extractVideoThumbnail: jest.fn(),
    getVideoMetadata: jest.fn(),
    deleteDirectory: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, string> = {
        VIDEO_THUMBNAIL_QUALITY: '80',
      };
      return config[key];
    }),
  };

  const mockWebhookService = {
    sendWebhook: jest.fn().mockResolvedValue(undefined),
  };

  const mockUserService = {
    resolveUser: jest.fn(),
  };

  const mockRouteHelperService = {
    path: jest.fn((...segments: string[]) => '/' + segments.join('/')),
    fullUrl: jest.fn((...segments: string[]) => 'http://localhost:3000/' + segments.join('/')),
    apiPrefix: 'v2',
    baseUrl: 'http://localhost:3000',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VideoService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: WebhookService, useValue: mockWebhookService },
        { provide: UserService, useValue: mockUserService },
        { provide: RouteHelperService, useValue: mockRouteHelperService },
      ],
    }).compile();

    service = module.get<VideoService>(VideoService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('uploadVideo', () => {
    let mockFd: { read: jest.Mock; close: jest.Mock };

    beforeEach(() => {
      mockFd = {
        read: jest.fn().mockImplementation((buffer: Buffer) => {
          mockMp4Magic.copy(buffer);
          return Promise.resolve({ bytesRead: 8 });
        }),
        close: jest.fn().mockResolvedValue(undefined),
      };
      (fsPromises.open as jest.Mock).mockResolvedValue(mockFd);
      (fsPromises.unlink as jest.Mock).mockResolvedValue(undefined);

      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);
      mockUserService.resolveUser.mockResolvedValue(mockUser);
      mockStorageService.getVideoFilePath.mockImplementation(
        (domain: string, id: string, variant: string) =>
          `storage/${domain}/videos/${id}/${variant}.mp4`,
      );
      mockStorageService.copyFromTemp.mockResolvedValue(undefined);
      mockStorageService.extractVideoThumbnail.mockResolvedValue(undefined);
      mockStorageService.getVideoMetadata.mockResolvedValue({
        duration: 120,
        width: 1920,
        height: 1080,
      });
      mockPrismaService.video.create.mockResolvedValue(mockVideo);
    });

    it('should upload video successfully with user', async () => {
      const result = await service.uploadVideo(mockClientId, mockExternalUserId, mockFile);

      expect(result).toBeDefined();
      expect(result.id).toBe(mockVideoId);
      expect(result.originalName).toBe('test.mp4');
      expect(mockStorageService.copyFromTemp).toHaveBeenCalled();
      expect(mockStorageService.extractVideoThumbnail).toHaveBeenCalled();
      expect(mockPrismaService.video.create).toHaveBeenCalled();
    });

    it('should fire VIDEO_UPLOADED webhook (non-blocking)', async () => {
      await service.uploadVideo(mockClientId, mockExternalUserId, mockFile);

      expect(mockWebhookService.sendWebhook).toHaveBeenCalledWith(
        mockClientId,
        WebhookEvent.VIDEO_UPLOADED,
        expect.objectContaining({ videoId: mockVideoId }),
      );
    });

    it('should always unlink temp file even on error', async () => {
      mockPrismaService.client.findUnique.mockResolvedValue(null);

      await expect(
        service.uploadVideo(mockClientId, mockExternalUserId, mockFile),
      ).rejects.toThrow(BadRequestException);

      expect(fsPromises.unlink).toHaveBeenCalledWith(mockFile.path);
    });

    it('should throw BadRequestException for non-MP4 file', async () => {
      const invalidMagic = Buffer.alloc(8);
      const badFd = {
        read: jest.fn().mockImplementation((buffer: Buffer) => {
          invalidMagic.copy(buffer);
          return Promise.resolve({ bytesRead: 8 });
        }),
        close: jest.fn().mockResolvedValue(undefined),
      };
      (fsPromises.open as jest.Mock).mockResolvedValue(badFd);

      await expect(
        service.uploadVideo(mockClientId, mockExternalUserId, mockFile),
      ).rejects.toThrow('File is not a valid MP4');
    });

    it('should throw BadRequestException when client not found', async () => {
      mockPrismaService.client.findUnique.mockResolvedValue(null);

      await expect(
        service.uploadVideo(mockClientId, mockExternalUserId, mockFile),
      ).rejects.toThrow('Client not found');
    });

    it('should use system user when no externalUserId provided', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockSystemUser);

      await service.uploadVideo(mockClientId, undefined, mockFile);

      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: {
          clientId_externalUserId: { clientId: mockClientId, externalUserId: 'system' },
        },
      });
      expect(mockUserService.resolveUser).not.toHaveBeenCalled();
    });

    it('should throw when system user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        service.uploadVideo(mockClientId, undefined, mockFile),
      ).rejects.toThrow('System user not found for client');
    });

    it('should continue when thumbnail extraction fails', async () => {
      mockStorageService.extractVideoThumbnail.mockRejectedValue(new Error('ffmpeg error'));

      const result = await service.uploadVideo(mockClientId, mockExternalUserId, mockFile);

      expect(result).toBeDefined();
      expect(mockPrismaService.video.create).toHaveBeenCalled();
    });

    it('should store null duration/dimensions when metadata extraction fails', async () => {
      mockStorageService.getVideoMetadata.mockRejectedValue(new Error('probe error'));

      await service.uploadVideo(mockClientId, mockExternalUserId, mockFile);

      expect(mockPrismaService.video.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ duration: null, width: null, height: null }),
        }),
      );
    });

    it('should store video with tags when provided', async () => {
      await service.uploadVideo(
        mockClientId,
        mockExternalUserId,
        mockFile,
        ['comedy', 'short'],
      );

      expect(mockPrismaService.video.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            videoTags: expect.objectContaining({ create: expect.any(Array) }),
          }),
        }),
      );
    });

    it('should store video as private when isPrivate=true', async () => {
      await service.uploadVideo(
        mockClientId,
        mockExternalUserId,
        mockFile,
        undefined,
        undefined,
        true,
      );

      expect(mockPrismaService.video.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isPrivate: true }),
        }),
      );
    });

    it('should use clientId as domain when client has no domain', async () => {
      mockPrismaService.client.findUnique.mockResolvedValue({ ...mockClient, domain: null });

      await service.uploadVideo(mockClientId, mockExternalUserId, mockFile);

      expect(mockStorageService.getVideoFilePath).toHaveBeenCalledWith(
        mockClientId,
        expect.any(String),
        'original',
      );
    });
  });

  describe('getVideoById', () => {
    it('should return video when found with clientId', async () => {
      mockPrismaService.video.findFirst.mockResolvedValue(mockVideo);

      const result = await service.getVideoById(mockVideoId, mockClientId);

      expect(result).toEqual(mockVideo);
      expect(mockPrismaService.video.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockVideoId, clientId: mockClientId },
        }),
      );
    });

    it('should query without clientId when not provided', async () => {
      mockPrismaService.video.findFirst.mockResolvedValue(mockVideo);

      await service.getVideoById(mockVideoId);

      expect(mockPrismaService.video.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: mockVideoId } }),
      );
    });

    it('should throw NotFoundException when video not found', async () => {
      mockPrismaService.video.findFirst.mockResolvedValue(null);

      await expect(service.getVideoById(mockVideoId, mockClientId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getVideoStreamPath', () => {
    it('should return stream path for public video', async () => {
      mockPrismaService.video.findFirst.mockResolvedValue(mockVideo);
      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);
      mockPrismaService.video.update.mockResolvedValue(mockVideo);

      const result = await service.getVideoStreamPath(mockVideoId, mockClientId);

      expect(result.storagePath).toBe(mockVideo.storagePath);
      expect(result.domain).toBe(mockDomain);
      expect(result.originalName).toBe('test.mp4');
    });

    it('should throw ForbiddenException for private video', async () => {
      mockPrismaService.video.findFirst.mockResolvedValue({ ...mockVideo, isPrivate: true });

      await expect(
        service.getVideoStreamPath(mockVideoId, mockClientId),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should increment view count non-blocking', async () => {
      mockPrismaService.video.findFirst.mockResolvedValue(mockVideo);
      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);
      mockPrismaService.video.update.mockResolvedValue(mockVideo);

      await service.getVideoStreamPath(mockVideoId, mockClientId);

      expect(mockPrismaService.video.update).toHaveBeenCalledWith({
        where: { id: mockVideoId },
        data: { views: { increment: 1 } },
      });
    });

    it('should use clientId as domain when client has no domain', async () => {
      mockPrismaService.video.findFirst.mockResolvedValue(mockVideo);
      mockPrismaService.client.findUnique.mockResolvedValue({ ...mockClient, domain: null });
      mockPrismaService.video.update.mockResolvedValue(mockVideo);

      const result = await service.getVideoStreamPath(mockVideoId, mockClientId);

      expect(result.domain).toBe(mockClientId);
    });
  });

  describe('listVideos', () => {
    beforeEach(() => {
      mockPrismaService.video.findMany.mockResolvedValue([mockVideo]);
      mockPrismaService.video.count.mockResolvedValue(1);
    });

    it('should return paginated video list', async () => {
      const result = await service.listVideos({ clientId: mockClientId });

      expect(result).toBeDefined();
      expect(mockPrismaService.video.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clientId: mockClientId },
          skip: 0,
          take: 20,
        }),
      );
    });

    it('should filter by userId', async () => {
      await service.listVideos({ clientId: mockClientId, userId: mockUserId });

      expect(mockPrismaService.video.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: mockUserId }),
        }),
      );
    });

    it('should filter by tag', async () => {
      await service.listVideos({ clientId: mockClientId, tag: 'comedy' });

      expect(mockPrismaService.video.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            videoTags: { some: { tag: { name: 'comedy' } } },
          }),
        }),
      );
    });

    it('should cap perPage at 100', async () => {
      await service.listVideos({ clientId: mockClientId, perPage: 999 });

      expect(mockPrismaService.video.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('should use page 1 as minimum', async () => {
      await service.listVideos({ clientId: mockClientId, page: -5 });

      expect(mockPrismaService.video.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0 }),
      );
    });

    it('should return empty list when no videos', async () => {
      mockPrismaService.video.findMany.mockResolvedValue([]);
      mockPrismaService.video.count.mockResolvedValue(0);

      const result = await service.listVideos({ clientId: mockClientId });

      expect(result).toBeDefined();
    });

    it('should calculate correct skip for page 3 with perPage 10', async () => {
      await service.listVideos({ clientId: mockClientId, page: 3, perPage: 10 });

      expect(mockPrismaService.video.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });

  describe('deleteVideo', () => {
    it('should delete video and storage successfully', async () => {
      mockPrismaService.video.findFirst.mockResolvedValue(mockVideo);
      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);
      mockStorageService.getVideoPath.mockReturnValue(
        `storage/${mockDomain}/videos/${mockVideoId}`,
      );
      mockStorageService.deleteDirectory.mockResolvedValue(undefined);
      mockPrismaService.video.delete.mockResolvedValue(mockVideo);

      const result = await service.deleteVideo(mockVideoId, mockClientId);

      expect(result.success).toBe(true);
      expect(mockStorageService.deleteDirectory).toHaveBeenCalled();
      expect(mockPrismaService.video.delete).toHaveBeenCalledWith({
        where: { id: mockVideoId },
      });
    });

    it('should fire VIDEO_DELETED webhook', async () => {
      mockPrismaService.video.findFirst.mockResolvedValue(mockVideo);
      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);
      mockStorageService.getVideoPath.mockReturnValue('storage/path');
      mockStorageService.deleteDirectory.mockResolvedValue(undefined);
      mockPrismaService.video.delete.mockResolvedValue(mockVideo);

      await service.deleteVideo(mockVideoId, mockClientId);

      expect(mockWebhookService.sendWebhook).toHaveBeenCalledWith(
        mockClientId,
        WebhookEvent.VIDEO_DELETED,
        expect.objectContaining({ id: mockVideoId }),
      );
    });

    it('should throw NotFoundException when video not found', async () => {
      mockPrismaService.video.findFirst.mockResolvedValue(null);

      await expect(service.deleteVideo(mockVideoId, mockClientId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateVideoMetadata', () => {
    it('should update description and privacy', async () => {
      const updated = { ...mockVideo, description: 'New desc', isPrivate: true };
      mockPrismaService.video.findFirst.mockResolvedValue(mockVideo);
      mockPrismaService.video.update.mockResolvedValue(updated);

      const result = await service.updateVideoMetadata(
        mockVideoId,
        mockClientId,
        mockUserId,
        undefined,
        'New desc',
        true,
      );

      expect(result).toBeDefined();
      expect(mockPrismaService.video.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ description: 'New desc', isPrivate: true }),
        }),
      );
    });

    it('should throw NotFoundException when video not found', async () => {
      mockPrismaService.video.findFirst.mockResolvedValue(null);

      await expect(
        service.updateVideoMetadata(mockVideoId, mockClientId, mockUserId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should replace tags (deleteMany then create)', async () => {
      mockPrismaService.video.findFirst.mockResolvedValue(mockVideo);
      mockPrismaService.video.update.mockResolvedValue(mockVideo);

      await service.updateVideoMetadata(
        mockVideoId,
        mockClientId,
        mockUserId,
        ['new-tag'],
      );

      expect(mockPrismaService.video.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            videoTags: expect.objectContaining({ deleteMany: {} }),
          }),
        }),
      );
    });

    it('should not touch tags when tags param is undefined', async () => {
      mockPrismaService.video.findFirst.mockResolvedValue(mockVideo);
      mockPrismaService.video.update.mockResolvedValue(mockVideo);

      await service.updateVideoMetadata(mockVideoId, mockClientId, mockUserId, undefined, 'desc');

      const callData = mockPrismaService.video.update.mock.calls[0][0].data;
      expect(callData.videoTags).toBeUndefined();
    });
  });

  describe('getVideoMetadata', () => {
    it('should return formatted video response', async () => {
      mockPrismaService.video.findFirst.mockResolvedValue(mockVideo);

      const result = await service.getVideoMetadata(mockVideoId, mockClientId);

      expect(result).toBeDefined();
      expect(result.id).toBe(mockVideoId);
      expect(result.fullPath).toBeDefined();
      expect(result.fullThumbnailUrl).toBeDefined();
    });
  });

  describe('validateUserId', () => {
    it('should return userId when provided', () => {
      expect(service.validateUserId('user-123')).toBe('user-123');
    });

    it('should throw BadRequestException when userId is undefined', () => {
      expect(() => service.validateUserId(undefined)).toThrow(BadRequestException);
    });

    it('should throw BadRequestException when userId is empty string', () => {
      expect(() => service.validateUserId('')).toThrow(BadRequestException);
    });
  });

  describe('formatVideoResponse', () => {
    it('should include fullPath with stream segment', () => {
      const result = service.formatVideoResponse(mockVideo);

      expect(result.fullPath).toContain('videos');
      expect(result.fullPath).toContain(mockVideoId);
      expect(result.fullPath).toContain('stream');
    });

    it('should include fullThumbnailUrl with thumb segment', () => {
      const result = service.formatVideoResponse(mockVideo);

      expect(result.fullThumbnailUrl).toContain('videos');
      expect(result.fullThumbnailUrl).toContain(mockVideoId);
      expect(result.fullThumbnailUrl).toContain('thumb');
    });

    it('should extract tag names from videoTags relation', () => {
      const videoWithTags = {
        ...mockVideo,
        videoTags: [{ tag: { name: 'comedy' } }, { tag: { name: 'short' } }],
      };

      const result = service.formatVideoResponse(videoWithTags);

      expect(result.tags).toContain('comedy');
      expect(result.tags).toContain('short');
    });

    it('should return empty tags array when no tags', () => {
      const result = service.formatVideoResponse(mockVideo);

      expect(result.tags).toEqual([]);
    });
  });
});
