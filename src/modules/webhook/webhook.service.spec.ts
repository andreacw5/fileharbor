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
              title: 'Nuova immagine caricata!',
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
              title: 'Nuova immagine caricata!',
              description: 'Una nuova immagine è stata correttamente caricata.',
              color: 0xFFAD58,
              fields: expect.arrayContaining([
                { name: 'Identificativo', value: 'image-123' },
                { name: 'Dimensioni', value: '2000.00 KB', inline: true },
                { name: 'Utente', value: 'user-123', inline: true },
              ]),
              thumbnail: {
                url: `${mockBaseUrl}/images/image-123`,
              },
              footer: expect.objectContaining({
                text: 'FileHarbor Monitoring Sender',
                icon_url: `${mockBaseUrl}/images/image-123`,
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
              title: 'Immagine eliminata',
              description: "Un'immagine è stata eliminata.",
              color: 0xe74c3c,
              fields: expect.arrayContaining([
                { name: 'Identificativo', value: 'image-123' },
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
              title: 'Nuovo avatar caricato!',
              description: 'Un nuovo avatar è stato correttamente caricato.',
              color: 0xFFAD58,
              fields: expect.arrayContaining([
                { name: 'Identificativo', value: 'avatar-123' },
                { name: 'Dimensioni', value: '500.00 KB', inline: true },
                { name: 'Utente', value: 'user-123', inline: true },
              ]),
              thumbnail: {
                url: `${mockBaseUrl}/avatars/user-123`,
              },
              footer: expect.objectContaining({
                text: 'FileHarbor Monitoring Sender',
                icon_url: `${mockBaseUrl}/avatars/user-123`,
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
              title: 'Avatar eliminato',
              description: 'Un avatar è stato eliminato.',
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
              title: 'Nuovo album creato!',
              description: 'Un nuovo album è stato creato.',
              color: 0x2ecc71,
              fields: expect.arrayContaining([
                { name: 'Identificativo', value: 'album-123' },
                { name: 'Nome', value: 'Test Album' },
                { name: 'Pubblico', value: 'Sì', inline: true },
                { name: 'Utente', value: 'user-123', inline: true },
                { name: 'Descrizione', value: 'Test Description' },
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

      expect(embedFields).toContainEqual({ name: 'Pubblico', value: 'No', inline: true });
      expect(embedFields).not.toContainEqual(
        expect.objectContaining({ name: 'Descrizione' }),
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
              title: 'Album aggiornato',
              description: 'Un album è stato aggiornato.',
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
              title: 'Album eliminato',
              description: 'Un album è stato eliminato.',
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
              title: "Immagine aggiunta all'album",
              description: 'Una immagine è stata aggiunta a un album.',
              color: 0x3498db,
              fields: expect.arrayContaining([
                { name: 'Album', value: 'Test Album' },
                { name: 'Immagine', value: 'image-123' },
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
              title: "Immagine rimossa dall'album",
              description: 'Una immagine è stata rimossa da un album.',
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
          text: 'FileHarbor Monitoring Sender',
        }),
      );
    });

    it('should handle missing data gracefully with N/A values', async () => {
      await service.sendWebhook(mockClientId, WebhookEvent.IMAGE_UPLOADED, {});

      const call = mockHttpService.post.mock.calls[0];
      const embed = call[1].embeds[0];

      expect(embed.fields).toContainEqual({ name: 'Identificativo', value: 'N/A' });
      expect(embed.fields).toContainEqual({ name: 'Utente', value: 'System', inline: true });
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
