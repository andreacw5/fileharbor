import { ConfigService } from '@nestjs/config';
import { BastionAuditService, AuditActor } from './bastion-audit.service';
import { BastionService } from './bastion.service';

jest.mock('jose', () => ({
  decodeJwt: jest.fn(),
}));

import { decodeJwt } from 'jose';

const SERVICE_TENANT = '4fe2598d-7e92-4e79-a2ed-628ec9516de8';

const adminUser = (overrides: Partial<AuditActor> = {}): AuditActor => ({
  sub: 'user-uuid',
  appSlug: 'meridian',
  role: 'ADMIN',
  tenantId: SERVICE_TENANT,
  tenantSlug: 'heyatom',
  ...overrides,
});

// `null` = token with no tenantId. Don't pass `undefined`: that would trigger
// the parameter default.
function setup(tenantId: string | null = SERVICE_TENANT, apiKey = 'api-key') {
  (decodeJwt as jest.Mock).mockReturnValue({
    exp: Math.floor(Date.now() / 1000) + 3600,
    tenantId: tenantId ?? undefined,
  });
  const bastion = {
    clientAuth: jest.fn().mockResolvedValue({ accessToken: 'header.body.sig' }),
    writeAuditEvent: jest
      .fn()
      .mockResolvedValue({ id: 'e1', createdAt: '2026-01-01T00:00:00Z' }),
  } as unknown as BastionService;
  const config = {
    get: (key: string) => (key === 'bastionClientApiKey' ? apiKey : undefined),
  } as unknown as ConfigService;
  return { bastion, service: new BastionAuditService(bastion, config) };
}

describe('BastionAuditService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('write', () => {
    it('sends the event with the service-client token', async () => {
      const { bastion, service } = setup();

      await service.write('fh_image.deleted', { metadata: { id: 'i1' } });

      expect(bastion.writeAuditEvent).toHaveBeenCalledWith('header.body.sig', {
        event: 'fh_image.deleted',
        metadata: { id: 'i1' },
      });
    });

    it('swallows a Bastion failure instead of propagating it', async () => {
      const { bastion, service } = setup();
      (bastion.writeAuditEvent as jest.Mock).mockRejectedValue(
        new Error('boom'),
      );

      await expect(service.write('fh_image.deleted')).resolves.toBeUndefined();
    });

    it('swallows a failure to obtain the token', async () => {
      const { bastion, service } = setup();
      (bastion.clientAuth as jest.Mock).mockRejectedValue(
        new Error('bastion down'),
      );

      await expect(service.write('fh_image.deleted')).resolves.toBeUndefined();
      expect(bastion.writeAuditEvent).not.toHaveBeenCalled();
    });

    it('reuses the cached token across writes', async () => {
      const { bastion, service } = setup();

      await service.write('fh_image.uploaded');
      await service.write('fh_image.deleted');

      expect(bastion.clientAuth).toHaveBeenCalledTimes(1);
    });
  });

  // Without an API key there is no service client to authenticate as, so every
  // write would fail identically. It must degrade quietly, not take the admin
  // API down with it.
  describe('with no BASTION_CLIENT_API_KEY', () => {
    it('skips writes entirely instead of failing them', async () => {
      const { bastion, service } = setup(SERVICE_TENANT, '');

      await service.write('fh_image.deleted');
      await service.writeAsAdmin('fh_image.deleted', adminUser());

      expect(bastion.clientAuth).not.toHaveBeenCalled();
      expect(bastion.writeAuditEvent).not.toHaveBeenCalled();
    });

    it('warns once at startup and does not try to reach Bastion', async () => {
      const { bastion, service } = setup(SERVICE_TENANT, '');
      const warn = jest.spyOn(service['logger'], 'warn').mockImplementation();

      await service.onModuleInit();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(bastion.clientAuth).not.toHaveBeenCalled();
    });
  });

  describe('writeAsAdmin', () => {
    it('passes userId when the admin belongs to the service-client tenant', async () => {
      const { bastion, service } = setup();

      await service.writeAsAdmin('fh_image.deleted', adminUser(), { id: 'i1' });

      expect(bastion.writeAuditEvent).toHaveBeenCalledWith('header.body.sig', {
        event: 'fh_image.deleted',
        userId: 'user-uuid',
        metadata: { id: 'i1' },
      });
    });

    it('falls back to actor metadata when the tenants differ', async () => {
      const { bastion, service } = setup();

      await service.writeAsAdmin(
        'fh_image.deleted',
        adminUser({ tenantId: 'another-tenant', tenantSlug: 'other' }),
        { id: 'i1' },
      );

      expect(bastion.writeAuditEvent).toHaveBeenCalledWith('header.body.sig', {
        event: 'fh_image.deleted',
        metadata: {
          id: 'i1',
          actorId: 'user-uuid',
          actorRole: 'ADMIN',
          actorAppSlug: 'meridian',
        },
      });
      // No userId: with one, Bastion answers 400 and the event is lost.
      expect(
        (bastion.writeAuditEvent as jest.Mock).mock.calls[0][1],
      ).not.toHaveProperty('userId');
    });

    it('warns about a tenant mismatch only once', async () => {
      const { service } = setup();
      const warn = jest.spyOn(service['logger'], 'warn').mockImplementation();

      const foreign = adminUser({ tenantId: 'another-tenant' });
      await service.writeAsAdmin('fh_image.deleted', foreign);
      await service.writeAsAdmin('fh_image.updated', foreign);

      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('still writes the event when no actor is present', async () => {
      const { bastion, service } = setup();

      await service.writeAsAdmin('fh_image.deleted', undefined, { id: 'i1' });

      expect(bastion.writeAuditEvent).toHaveBeenCalledWith('header.body.sig', {
        event: 'fh_image.deleted',
        metadata: {
          id: 'i1',
          actorId: 'unknown',
          actorRole: 'unknown',
          actorAppSlug: 'unknown',
        },
      });
    });
  });
});
