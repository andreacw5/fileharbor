import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ClientService } from './client.service';
import { PrismaService } from '@/modules/prisma/prisma.service';

describe('ClientService', () => {
  let service: ClientService;
  let prismaService: PrismaService;

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

  const mockUser = {
    id: 'user-123',
    clientId: 'client-123',
    externalUserId: 'ext-user-123',
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
    },
    user: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
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
    prismaService = module.get<PrismaService>(PrismaService);

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

      await expect(service.validateClient('fh_test_api_key_123')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.validateClient('fh_test_api_key_123')).rejects.toThrow(
        'Invalid or inactive client',
      );
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
    it('should create new user when user does not exist', async () => {
      mockPrismaService.user.upsert.mockResolvedValue(mockUser);

      const result = await service.getOrCreateUser(
        'client-123',
        'ext-user-123',
        'test@example.com',
        'testuser',
      );

      expect(result).toEqual(mockUser);
      expect(mockPrismaService.user.upsert).toHaveBeenCalledWith({
        where: {
          clientId_externalUserId: {
            clientId: 'client-123',
            externalUserId: 'ext-user-123',
          },
        },
        update: {
          email: 'test@example.com',
          username: 'testuser',
        },
        create: {
          clientId: 'client-123',
          externalUserId: 'ext-user-123',
          email: 'test@example.com',
          username: 'testuser',
        },
      });
    });

    it('should update existing user with new email and username', async () => {
      const updatedUser = {
        ...mockUser,
        email: 'updated@example.com',
        username: 'updateduser',
      };
      mockPrismaService.user.upsert.mockResolvedValue(updatedUser);

      const result = await service.getOrCreateUser(
        'client-123',
        'ext-user-123',
        'updated@example.com',
        'updateduser',
      );

      expect(result).toEqual(updatedUser);
    });

    it('should handle undefined email and username', async () => {
      mockPrismaService.user.upsert.mockResolvedValue({
        ...mockUser,
        email: null,
        username: null,
      });

      const result = await service.getOrCreateUser(
        'client-123',
        'ext-user-123',
      );

      expect(mockPrismaService.user.upsert).toHaveBeenCalledWith({
        where: {
          clientId_externalUserId: {
            clientId: 'client-123',
            externalUserId: 'ext-user-123',
          },
        },
        update: {
          email: undefined,
          username: undefined,
        },
        create: {
          clientId: 'client-123',
          externalUserId: 'ext-user-123',
          email: undefined,
          username: undefined,
        },
      });
      expect(result).toBeDefined();
    });
  });

  describe('getUserByExternalId', () => {
    it('should return user when found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getUserByExternalId(
        'client-123',
        'ext-user-123',
      );

      expect(result).toEqual(mockUser);
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: {
          clientId_externalUserId: {
            clientId: 'client-123',
            externalUserId: 'ext-user-123',
          },
        },
      });
    });

    it('should return null when user is not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      const result = await service.getUserByExternalId(
        'client-123',
        'non-existent-user',
      );

      expect(result).toBeNull();
    });
  });

  describe('createClient', () => {
    it('should create a new client with generated API key and default users', async () => {
      const newClient = {
        ...mockClient,
        name: 'New Client',
        domain: 'new.fileharbor.local',
      };

      mockPrismaService.client.create.mockResolvedValue(newClient);
      mockPrismaService.user.count.mockResolvedValue(0);
      mockPrismaService.user.create.mockResolvedValue(mockUser);

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

      // Verify default users were created
      expect(mockPrismaService.user.count).toHaveBeenCalledWith({
        where: { clientId: newClient.id },
      });
      expect(mockPrismaService.user.create).toHaveBeenCalledTimes(2);

      // Verify administrator user
      expect(mockPrismaService.user.create).toHaveBeenCalledWith({
        data: {
          clientId: newClient.id,
          externalUserId: 'administrator',
          username: 'administrator',
        },
      });

      // Verify system user
      expect(mockPrismaService.user.create).toHaveBeenCalledWith({
        data: {
          clientId: newClient.id,
          externalUserId: 'system',
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
      mockPrismaService.user.count.mockResolvedValue(0);
      mockPrismaService.user.create.mockResolvedValue(mockUser);

      await service.createClient({
        name: 'Inactive Client',
        active: false,
      });

      const createCall = mockPrismaService.client.create.mock.calls[0][0];
      expect(createCall.data.active).toBe(false);
    });

    it('should not create default users if users already exist', async () => {
      mockPrismaService.client.create.mockResolvedValue(mockClient);
      mockPrismaService.user.count.mockResolvedValue(2);

      await service.createClient({
        name: 'Existing Users Client',
      });

      expect(mockPrismaService.user.create).not.toHaveBeenCalled();
    });

    it('should create client without domain when not specified', async () => {
      const clientWithoutDomain = {
        ...mockClient,
        domain: undefined,
      };

      mockPrismaService.client.create.mockResolvedValue(clientWithoutDomain);
      mockPrismaService.user.count.mockResolvedValue(0);
      mockPrismaService.user.create.mockResolvedValue(mockUser);

      await service.createClient({
        name: 'No Domain Client',
      });

      const createCall = mockPrismaService.client.create.mock.calls[0][0];
      expect(createCall.data.domain).toBeUndefined();
    });

    it('should generate unique API keys for different clients', async () => {
      mockPrismaService.client.create.mockResolvedValue(mockClient);
      mockPrismaService.user.count.mockResolvedValue(1);

      await service.createClient({ name: 'Client 1' });
      const apiKey1 = mockPrismaService.client.create.mock.calls[0][0].data.apiKey;

      jest.clearAllMocks();
      mockPrismaService.client.create.mockResolvedValue(mockClient);

      await service.createClient({ name: 'Client 2' });
      const apiKey2 = mockPrismaService.client.create.mock.calls[0][0].data.apiKey;

      // API keys should be different (with very high probability)
      expect(apiKey1).not.toBe(apiKey2);
    });
  });

  describe('generateApiKey (private method)', () => {
    it('should generate API keys with correct format', async () => {
      mockPrismaService.client.create.mockResolvedValue(mockClient);
      mockPrismaService.user.count.mockResolvedValue(1);

      await service.createClient({ name: 'Test Client' });

      const apiKey = mockPrismaService.client.create.mock.calls[0][0].data.apiKey;

      // Should start with 'fh_'
      expect(apiKey).toMatch(/^fh_/);

      // Should have hex characters and timestamp parts
      expect(apiKey).toMatch(/^fh_[a-f0-9]{48}_[a-z0-9]+$/);

      // Should be at least 60 characters
      expect(apiKey.length).toBeGreaterThanOrEqual(60);
    });
  });
});
