import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { WebhookService, WebhookEvent } from './webhook.service';
import { PrismaService } from '@/modules/prisma/prisma.service';

describe('WebhookService', () => {
  let service: WebhookService;
  let httpService: HttpService;
  let prismaService: PrismaService;
  let configService: ConfigService;

  // Mock data
  const mockClientId = 'client-123';
  const mockWebhookUrl = 'https://discord.com/api/webhooks/123456789/test-webhook';
  const mockBaseUrl = 'http://localhost:3000';

  const mockClient = {
    id: mockClientId,
    name: 'Test Client',
    apiKey: 'test-api-key',
    webhookEnabled: true,
    webhookUrl: mockWebhookUrl,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockClientWithoutWebhook = {
    ...mockClient,
    webhookEnabled: false,
    webhookUrl: null,
  };

  // Mock services
  const mockHttpService = {
    post: jest.fn(),
  };

  const mockPrismaService = {
    client: {
      findUnique: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'BASE_URL') return mockBaseUrl;
      return undefined;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        {
          provide: HttpService,
          useValue: mockHttpService,
        },
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<WebhookService>(WebhookService);
    httpService = module.get<HttpService>(HttpService);
    prismaService = module.get<PrismaService>(PrismaService);
    configService = module.get<ConfigService>(ConfigService);

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendWebhook', () => {
    it('should send webhook when client has webhooks enabled', async () => {
      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);
      mockHttpService.post.mockReturnValue(of({ data: { success: true } }));

      const eventData = {
        imageId: 'image-123',
        size: 1024000,
        userId: 'user-123',
      };

      await service.sendWebhook(mockClientId, WebhookEvent.IMAGE_UPLOADED, eventData);

      expect(mockPrismaService.client.findUnique).toHaveBeenCalledWith({
        where: { id: mockClientId },
      });

      expect(mockHttpService.post).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: 'New Image Uploaded!',
              color: 0xFFAD58,
            }),
          ]),
          timestamp: expect.any(String),
        }),
      );
    });

    it('should not send webhook when client not found', async () => {
      mockPrismaService.client.findUnique.mockResolvedValue(null);

      await service.sendWebhook(mockClientId, WebhookEvent.IMAGE_UPLOADED, {});

      expect(mockHttpService.post).not.toHaveBeenCalled();
    });

    it('should not send webhook when webhooks are disabled', async () => {
      mockPrismaService.client.findUnique.mockResolvedValue(mockClientWithoutWebhook);

      await service.sendWebhook(mockClientId, WebhookEvent.IMAGE_UPLOADED, {});

      expect(mockHttpService.post).not.toHaveBeenCalled();
    });

    it('should not send webhook when webhook URL is not configured', async () => {
      mockPrismaService.client.findUnique.mockResolvedValue({
        ...mockClient,
        webhookUrl: null,
      });

      await service.sendWebhook(mockClientId, WebhookEvent.IMAGE_UPLOADED, {});

      expect(mockHttpService.post).not.toHaveBeenCalled();
    });

    it('should not throw error when webhook send fails', async () => {
      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);
      mockHttpService.post.mockReturnValue(
        throwError(() => new Error('Network error')),
      );

      await expect(
        service.sendWebhook(mockClientId, WebhookEvent.IMAGE_UPLOADED, {}),
      ).resolves.not.toThrow();
    });

    it('should not throw error when database query fails', async () => {
      mockPrismaService.client.findUnique.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(
        service.sendWebhook(mockClientId, WebhookEvent.IMAGE_UPLOADED, {}),
      ).resolves.not.toThrow();
    });
  });

  describe('IMAGE_UPLOADED event', () => {
    beforeEach(() => {
      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);
      mockHttpService.post.mockReturnValue(of({ data: { success: true } }));
    });

    it('should send IMAGE_UPLOADED webhook with correct embed', async () => {
      const eventData = {
        imageId: 'image-123',
        size: 2048000,
        userId: 'user-123',
      };

      await service.sendWebhook(mockClientId, WebhookEvent.IMAGE_UPLOADED, eventData);

      expect(mockHttpService.post).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: 'New Image Uploaded!',
              description: 'A new image has been successfully uploaded.',
              color: 0xFFAD58,
              fields: expect.arrayContaining([
                { name: 'ID', value: 'image-123' },
                { name: 'Size', value: '1.95 MB', inline: true },
                { name: 'User', value: 'user-123', inline: true },
              ]),
              thumbnail: {
                url: `${mockBaseUrl}/images/image-123`,
              },
              footer: expect.objectContaining({
                text: 'FileHarbor Monitoring',
              }),
            }),
          ]),
        }),
      );
    });
  });

  describe('IMAGE_DELETED event', () => {
    beforeEach(() => {
      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);
      mockHttpService.post.mockReturnValue(of({ data: { success: true } }));
    });

    it('should send IMAGE_DELETED webhook with correct embed', async () => {
      const eventData = {
        id: 'image-123',
        timestamp: new Date().toISOString(),
      };

      await service.sendWebhook(mockClientId, WebhookEvent.IMAGE_DELETED, eventData);

      expect(mockHttpService.post).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: 'Image Deleted',
              description: 'An image has been deleted.',
              color: 0xe74c3c,
              fields: expect.arrayContaining([
                { name: 'ID', value: 'image-123' },
                { name: 'Timestamp', value: expect.any(String) },
              ]),
            }),
          ]),
        }),
      );
    });
  });

  describe('AVATAR_UPLOADED event', () => {
    beforeEach(() => {
      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);
      mockHttpService.post.mockReturnValue(of({ data: { success: true } }));
    });

    it('should send AVATAR_UPLOADED webhook with correct embed', async () => {
      const eventData = {
        avatarId: 'avatar-123',
        size: 512000,
        userId: 'user-123',
      };

      await service.sendWebhook(mockClientId, WebhookEvent.AVATAR_UPLOADED, eventData);

      expect(mockHttpService.post).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: 'New Avatar Uploaded!',
              description: 'A new avatar has been successfully uploaded.',
              color: 0xFFAD58,
              fields: expect.arrayContaining([
                { name: 'ID', value: 'avatar-123' },
                { name: 'Size', value: '500.00 KB', inline: true },
                { name: 'User', value: 'user-123', inline: true },
              ]),
              thumbnail: {
                url: `${mockBaseUrl}/avatars/user-123`,
              },
              footer: expect.objectContaining({
                text: 'FileHarbor Monitoring',
              }),
            }),
          ]),
        }),
      );
    });
  });

  describe('AVATAR_DELETED event', () => {
    beforeEach(() => {
      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);
      mockHttpService.post.mockReturnValue(of({ data: { success: true } }));
    });

    it('should send AVATAR_DELETED webhook with correct embed', async () => {
      const eventData = {
        id: 'avatar-123',
        timestamp: new Date().toISOString(),
      };

      await service.sendWebhook(mockClientId, WebhookEvent.AVATAR_DELETED, eventData);

      expect(mockHttpService.post).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: 'Avatar Deleted',
              description: 'An avatar has been deleted.',
              color: 0xe74c3c,
            }),
          ]),
        }),
      );
    });
  });

  describe('ALBUM_CREATED event', () => {
    beforeEach(() => {
      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);
      mockHttpService.post.mockReturnValue(of({ data: { success: true } }));
    });

    it('should send ALBUM_CREATED webhook with correct embed', async () => {
      const eventData = {
        albumId: 'album-123',
        name: 'Test Album',
        description: 'Test Description',
        isPublic: true,
        userId: 'user-123',
      };

      await service.sendWebhook(mockClientId, WebhookEvent.ALBUM_CREATED, eventData);

      expect(mockHttpService.post).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: 'New Album Created!',
              description: 'A new album has been created.',
              color: 0x2ecc71,
              fields: expect.arrayContaining([
                { name: 'ID', value: 'album-123' },
                { name: 'Name', value: 'Test Album' },
                { name: 'Public', value: 'Yes', inline: true },
                { name: 'User', value: 'user-123', inline: true },
                { name: 'Description', value: 'Test Description' },
              ]),
            }),
          ]),
        }),
      );
    });

    it('should send ALBUM_CREATED webhook without description when not provided', async () => {
      const eventData = {
        albumId: 'album-123',
        name: 'Test Album',
        isPublic: false,
        userId: 'user-123',
      };

      await service.sendWebhook(mockClientId, WebhookEvent.ALBUM_CREATED, eventData);

      const call = mockHttpService.post.mock.calls[0];
      const embedFields = call[1].embeds[0].fields;

      expect(embedFields).toContainEqual({ name: 'Public', value: 'No', inline: true });
      expect(embedFields).not.toContainEqual(
        expect.objectContaining({ name: 'Description' }),
      );
    });
  });

  describe('ALBUM_UPDATED event', () => {
    beforeEach(() => {
      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);
      mockHttpService.post.mockReturnValue(of({ data: { success: true } }));
    });

    it('should send ALBUM_UPDATED webhook with correct embed', async () => {
      const eventData = {
        albumId: 'album-123',
        name: 'Updated Album',
        description: 'Updated Description',
        isPublic: true,
        userId: 'user-123',
      };

      await service.sendWebhook(mockClientId, WebhookEvent.ALBUM_UPDATED, eventData);

      expect(mockHttpService.post).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: 'Album Updated',
              description: 'An album has been updated.',
              color: 0xf39c12,
            }),
          ]),
        }),
      );
    });
  });

  describe('ALBUM_DELETED event', () => {
    beforeEach(() => {
      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);
      mockHttpService.post.mockReturnValue(of({ data: { success: true } }));
    });

    it('should send ALBUM_DELETED webhook with correct embed', async () => {
      const eventData = {
        id: 'album-123',
        timestamp: new Date().toISOString(),
      };

      await service.sendWebhook(mockClientId, WebhookEvent.ALBUM_DELETED, eventData);

      expect(mockHttpService.post).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: 'Album Deleted',
              description: 'An album has been deleted.',
              color: 0xe74c3c,
            }),
          ]),
        }),
      );
    });
  });

  describe('IMAGE_ADDED_TO_ALBUM event', () => {
    beforeEach(() => {
      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);
      mockHttpService.post.mockReturnValue(of({ data: { success: true } }));
    });

    it('should send IMAGE_ADDED_TO_ALBUM webhook with correct embed', async () => {
      const eventData = {
        albumName: 'Test Album',
        imageId: 'image-123',
      };

      await service.sendWebhook(
        mockClientId,
        WebhookEvent.IMAGE_ADDED_TO_ALBUM,
        eventData,
      );

      expect(mockHttpService.post).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: 'Image Added to Album',
              description: 'An image has been added to an album.',
              color: 0x3498db,
              fields: expect.arrayContaining([
                { name: 'Album', value: 'Test Album' },
                { name: 'Image', value: 'image-123' },
              ]),
            }),
          ]),
        }),
      );
    });
  });

  describe('IMAGE_REMOVED_FROM_ALBUM event', () => {
    beforeEach(() => {
      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);
      mockHttpService.post.mockReturnValue(of({ data: { success: true } }));
    });

    it('should send IMAGE_REMOVED_FROM_ALBUM webhook with correct embed', async () => {
      const eventData = {
        id: 'image-123',
        timestamp: new Date().toISOString(),
      };

      await service.sendWebhook(
        mockClientId,
        WebhookEvent.IMAGE_REMOVED_FROM_ALBUM,
        eventData,
      );

      expect(mockHttpService.post).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: 'Image Removed from Album',
              description: 'An image has been removed from an album.',
              color: 0xe74c3c,
            }),
          ]),
        }),
      );
    });
  });

  describe('webhook payload structure', () => {
    beforeEach(() => {
      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);
      mockHttpService.post.mockReturnValue(of({ data: { success: true } }));
    });

    it('should include timestamp in webhook payload', async () => {
      await service.sendWebhook(mockClientId, WebhookEvent.IMAGE_UPLOADED, {
        imageId: 'test',
        size: 1000,
        userId: 'user-1',
      });

      expect(mockHttpService.post).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          timestamp: expect.any(String),
        }),
      );
    });

    it('should include footer with FileHarbor branding', async () => {
      await service.sendWebhook(mockClientId, WebhookEvent.IMAGE_UPLOADED, {
        imageId: 'test',
        size: 1000,
        userId: 'user-1',
      });

      const call = mockHttpService.post.mock.calls[0];
      const embed = call[1].embeds[0];

      expect(embed.footer).toEqual(
        expect.objectContaining({
          text: 'FileHarbor Monitoring',
        }),
      );
    });

    it('should handle missing data gracefully with N/A values', async () => {
      await service.sendWebhook(mockClientId, WebhookEvent.IMAGE_UPLOADED, {});

      const call = mockHttpService.post.mock.calls[0];
      const embed = call[1].embeds[0];

      expect(embed.fields).toContainEqual({ name: 'ID', value: 'N/A' });
      expect(embed.fields).toContainEqual({ name: 'User', value: 'System', inline: true });
    });
  });

  describe('BASE_URL configuration', () => {
    it('should use configured BASE_URL for image thumbnails', async () => {
      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);
      mockHttpService.post.mockReturnValue(of({ data: { success: true } }));

      await service.sendWebhook(mockClientId, WebhookEvent.IMAGE_UPLOADED, {
        imageId: 'image-123',
        size: 1000,
        userId: 'user-1',
      });

      const call = mockHttpService.post.mock.calls[0];
      const embed = call[1].embeds[0];

      expect(embed.thumbnail.url).toBe(`${mockBaseUrl}/images/image-123`);
    });

    it('should use configured BASE_URL for avatar thumbnails', async () => {
      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);
      mockHttpService.post.mockReturnValue(of({ data: { success: true } }));

      await service.sendWebhook(mockClientId, WebhookEvent.AVATAR_UPLOADED, {
        avatarId: 'avatar-123',
        size: 1000,
        userId: 'user-123',
      });

      const call = mockHttpService.post.mock.calls[0];
      const embed = call[1].embeds[0];

      expect(embed.thumbnail.url).toBe(`${mockBaseUrl}/avatars/user-123`);
    });
  });

  describe('error handling', () => {
    it('should handle HTTP errors gracefully', async () => {
      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);
      mockHttpService.post.mockReturnValue(
        throwError(() => new Error('HTTP 500 error')),
      );

      await expect(
        service.sendWebhook(mockClientId, WebhookEvent.IMAGE_UPLOADED, {
          imageId: 'test',
          size: 1000,
          userId: 'user-1',
        }),
      ).resolves.not.toThrow();
    });

    it('should handle network timeout errors gracefully', async () => {
      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);
      mockHttpService.post.mockReturnValue(
        throwError(() => new Error('ETIMEDOUT')),
      );

      await expect(
        service.sendWebhook(mockClientId, WebhookEvent.IMAGE_UPLOADED, {
          imageId: 'test',
          size: 1000,
          userId: 'user-1',
        }),
      ).resolves.not.toThrow();
    });

    it('should handle malformed webhook URL gracefully', async () => {
      mockPrismaService.client.findUnique.mockResolvedValue({
        ...mockClient,
        webhookUrl: 'not-a-valid-url',
      });
      mockHttpService.post.mockReturnValue(
        throwError(() => new Error('Invalid URL')),
      );

      await expect(
        service.sendWebhook(mockClientId, WebhookEvent.IMAGE_UPLOADED, {
          imageId: 'test',
          size: 1000,
          userId: 'user-1',
        }),
      ).resolves.not.toThrow();
    });
  });
});
