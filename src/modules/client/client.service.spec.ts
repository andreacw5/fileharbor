import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClientService } from './client.service';
import { PrismaService } from '@/modules/prisma/prisma.service';

describe('ClientService', () => {
  let service: ClientService;

  // Mock data
  const mockClient = {
    id: 'client-123',
    name: 'Test Client',
    apiKey: 'fh_test_api_key_123',
    domain: 'test.fileharbor.local',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCreator = {
    id: 'creator-123',
    clientId: 'client-123',
    externalId: 'ext-creator-123',
    email: 'test@example.com',
    username: 'testuser',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockInactiveClient = {
    ...mockClient,
    id: 'client-456',
    active: false,
  };

  // Mock PrismaService
  const mockPrismaService = {
    client: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    creator: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    image: {
      aggregate: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<ClientService>(ClientService);

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateClient', () => {
    it('should return client when API key is valid and client is active', async () => {
      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);

      const result = await service.validateClient('fh_test_api_key_123');

      expect(result).toEqual(mockClient);
      expect(mockPrismaService.client.findUnique).toHaveBeenCalledWith({
        where: { apiKey: 'fh_test_api_key_123' },
      });
    });

    it('should throw UnauthorizedException when client is not found', async () => {
      mockPrismaService.client.findUnique.mockResolvedValue(null);

      await expect(service.validateClient('invalid_api_key')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.validateClient('invalid_api_key')).rejects.toThrow(
        'Invalid or inactive client',
      );
    });

    it('should throw UnauthorizedException when client is inactive', async () => {
      mockPrismaService.client.findUnique.mockResolvedValue(mockInactiveClient);

      await expect(
        service.validateClient('fh_test_api_key_123'),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.validateClient('fh_test_api_key_123'),
      ).rejects.toThrow('Invalid or inactive client');
    });
  });

  describe('getClientById', () => {
    it('should return client when found', async () => {
      mockPrismaService.client.findUnique.mockResolvedValue(mockClient);

      const result = await service.getClientById('client-123');

      expect(result).toEqual(mockClient);
      expect(mockPrismaService.client.findUnique).toHaveBeenCalledWith({
        where: { id: 'client-123' },
      });
    });

    it('should return null when client is not found', async () => {
      mockPrismaService.client.findUnique.mockResolvedValue(null);

      const result = await service.getClientById('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('getOrCreateUser', () => {
    it('should create new creator when creator does not exist', async () => {
      mockPrismaService.creator.upsert.mockResolvedValue(mockCreator);

      const result = await service.getOrCreateUser(
        'client-123',
        'ext-creator-123',
        'test@example.com',
        'testuser',
      );

      expect(result).toEqual(mockCreator);
      expect(mockPrismaService.creator.upsert).toHaveBeenCalledWith({
        where: {
          clientId_externalId: {
            clientId: 'client-123',
            externalId: 'ext-creator-123',
          },
        },
        update: {
          email: 'test@example.com',
          username: 'testuser',
        },
        create: {
          clientId: 'client-123',
          externalId: 'ext-creator-123',
          email: 'test@example.com',
          username: 'testuser',
        },
      });
    });

    it('should update existing creator with new email and username', async () => {
      const updatedUser = {
        ...mockCreator,
        email: 'updated@example.com',
        username: 'updateduser',
      };
      mockPrismaService.creator.upsert.mockResolvedValue(updatedUser);

      const result = await service.getOrCreateUser(
        'client-123',
        'ext-creator-123',
        'updated@example.com',
        'updateduser',
      );

      expect(result).toEqual(updatedUser);
    });

    it('should handle undefined email and username', async () => {
      mockPrismaService.creator.upsert.mockResolvedValue({
        ...mockCreator,
        email: null,
        username: null,
      });

      const result = await service.getOrCreateUser(
        'client-123',
        'ext-creator-123',
      );

      expect(mockPrismaService.creator.upsert).toHaveBeenCalledWith({
        where: {
          clientId_externalId: {
            clientId: 'client-123',
            externalId: 'ext-creator-123',
          },
        },
        update: {
          email: undefined,
          username: undefined,
        },
        create: {
          clientId: 'client-123',
          externalId: 'ext-creator-123',
          email: undefined,
          username: undefined,
        },
      });
      expect(result).toBeDefined();
    });
  });

  describe('getUserByExternalId', () => {
    it('should return creator when found', async () => {
      mockPrismaService.creator.findUnique.mockResolvedValue(mockCreator);

      const result = await service.getUserByExternalId(
        'client-123',
        'ext-creator-123',
      );

      expect(result).toEqual(mockCreator);
      expect(mockPrismaService.creator.findUnique).toHaveBeenCalledWith({
        where: {
          clientId_externalId: {
            clientId: 'client-123',
            externalId: 'ext-creator-123',
          },
        },
      });
    });

    it('should return null when creator is not found', async () => {
      mockPrismaService.creator.findUnique.mockResolvedValue(null);

      const result = await service.getUserByExternalId(
        'client-123',
        'non-existent-creator',
      );

      expect(result).toBeNull();
    });
  });

  describe('createClient', () => {
    it('should create a new client with generated API key and default creators', async () => {
      const newClient = {
        ...mockClient,
        name: 'New Client',
        domain: 'new.fileharbor.local',
      };

      mockPrismaService.client.create.mockResolvedValue(newClient);
      mockPrismaService.creator.count.mockResolvedValue(0);
      mockPrismaService.creator.create.mockResolvedValue(mockCreator);

      const result = await service.createClient({
        name: 'New Client',
        domain: 'new.fileharbor.local',
      });

      expect(result).toEqual(newClient);
      expect(mockPrismaService.client.create).toHaveBeenCalled();

      // Verify API key format
      const createCall = mockPrismaService.client.create.mock.calls[0][0];
      expect(createCall.data.apiKey).toMatch(/^fh_[a-f0-9]{48}_[a-z0-9]+$/);
      expect(createCall.data.name).toBe('New Client');
      expect(createCall.data.domain).toBe('new.fileharbor.local');
      expect(createCall.data.active).toBe(true);

      // Verify default creators were created
      expect(mockPrismaService.creator.count).toHaveBeenCalledWith({
        where: { clientId: newClient.id },
      });
      expect(mockPrismaService.creator.create).toHaveBeenCalledTimes(2);

      // Verify administrator creator
      expect(mockPrismaService.creator.create).toHaveBeenCalledWith({
        data: {
          clientId: newClient.id,
          externalId: 'administrator',
          username: 'administrator',
        },
      });

      // Verify system creator
      expect(mockPrismaService.creator.create).toHaveBeenCalledWith({
        data: {
          clientId: newClient.id,
          externalId: 'system',
          username: 'system',
        },
      });
    });

    it('should create client with active=false when specified', async () => {
      const inactiveClient = {
        ...mockClient,
        active: false,
      };

      mockPrismaService.client.create.mockResolvedValue(inactiveClient);
      mockPrismaService.creator.count.mockResolvedValue(0);
      mockPrismaService.creator.create.mockResolvedValue(mockCreator);

      await service.createClient({
        name: 'Inactive Client',
        active: false,
      });

      const createCall = mockPrismaService.client.create.mock.calls[0][0];
      expect(createCall.data.active).toBe(false);
    });

    it('should not create default creators if creators already exist', async () => {
      mockPrismaService.client.create.mockResolvedValue(mockClient);
      mockPrismaService.creator.count.mockResolvedValue(2);

      await service.createClient({
        name: 'Existing Creators Client',
      });

      expect(mockPrismaService.creator.create).not.toHaveBeenCalled();
    });

    it('should create client without domain when not specified', async () => {
      const clientWithoutDomain = {
        ...mockClient,
        domain: undefined,
      };

      mockPrismaService.client.create.mockResolvedValue(clientWithoutDomain);
      mockPrismaService.creator.count.mockResolvedValue(0);
      mockPrismaService.creator.create.mockResolvedValue(mockCreator);

      await service.createClient({
        name: 'No Domain Client',
      });

      const createCall = mockPrismaService.client.create.mock.calls[0][0];
      expect(createCall.data.domain).toBeUndefined();
    });

    it('should generate unique API keys for different clients', async () => {
      mockPrismaService.client.create.mockResolvedValue(mockClient);
      mockPrismaService.creator.count.mockResolvedValue(1);

      await service.createClient({ name: 'Client 1' });
      const apiKey1 =
        mockPrismaService.client.create.mock.calls[0][0].data.apiKey;

      jest.clearAllMocks();
      mockPrismaService.client.create.mockResolvedValue(mockClient);

      await service.createClient({ name: 'Client 2' });
      const apiKey2 =
        mockPrismaService.client.create.mock.calls[0][0].data.apiKey;

      // API keys should be different (with very high probability)
      expect(apiKey1).not.toBe(apiKey2);
    });
  });

  describe('generateApiKey (private method)', () => {
    it('should generate API keys with correct format', async () => {
      mockPrismaService.client.create.mockResolvedValue(mockClient);
      mockPrismaService.creator.count.mockResolvedValue(1);

      await service.createClient({ name: 'Test Client' });

      const apiKey =
        mockPrismaService.client.create.mock.calls[0][0].data.apiKey;

      // Should start with 'fh_'
      expect(apiKey).toMatch(/^fh_/);

      // Should have hex characters and timestamp parts
      expect(apiKey).toMatch(/^fh_[a-f0-9]{48}_[a-z0-9]+$/);

      // Should be at least 60 characters
      expect(apiKey.length).toBeGreaterThanOrEqual(60);
    });
  });

  describe('updateClientWithStats', () => {
    const updatedClient = {
      ...mockClient,
      bastionTenantSlug: 'heyatom',
      _count: { images: 0, avatars: 0, albums: 0, videos: 0 },
    };

    it('updates the client and returns it enriched with stats', async () => {
      mockPrismaService.client.update.mockResolvedValue(updatedClient);
      mockPrismaService.image.aggregate.mockResolvedValue({
        _sum: { size: 1024 },
      });

      const result = await service.updateClientWithStats('client-123', {
        bastionTenantSlug: 'heyatom',
      });

      expect(mockPrismaService.client.update).toHaveBeenCalledWith({
        where: { id: 'client-123' },
        data: { bastionTenantSlug: 'heyatom' },
        include: {
          _count: {
            select: { images: true, avatars: true, albums: true, videos: true },
          },
        },
      });
      expect(result.bastionTenantSlug).toBe('heyatom');
      expect(result.totalStorage).toBe(1024);
    });

    it('maps a bastionTenantSlug unique constraint violation to a ConflictException', async () => {
      mockPrismaService.client.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`bastionTenantSlug`)',
          {
            code: 'P2002',
            clientVersion: '7.10.0',
            meta: { target: ['bastionTenantSlug'] },
          },
        ),
      );

      await expect(
        service.updateClientWithStats('client-123', {
          bastionTenantSlug: 'heyatom',
        }),
      ).rejects.toThrow(
        new ConflictException('Tenant slug already mapped to another client'),
      );
    });

    it('rethrows unrelated Prisma errors unchanged', async () => {
      const otherError = new Prisma.PrismaClientKnownRequestError(
        'Record not found',
        {
          code: 'P2025',
          clientVersion: '7.10.0',
        },
      );
      mockPrismaService.client.update.mockRejectedValue(otherError);

      await expect(
        service.updateClientWithStats('client-123', { name: 'New name' }),
      ).rejects.toBe(otherError);
    });
  });
});
