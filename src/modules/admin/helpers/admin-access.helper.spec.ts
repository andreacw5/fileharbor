import { ForbiddenException } from '@nestjs/common';
import { AdminJwtPayload } from '@/modules/bastion/bastion.types';
import { assertTenantSlugAllowed } from './admin-access.helper';

describe('assertTenantSlugAllowed', () => {
  const admin = (fullAccess: boolean) =>
    ({ tenantSlug: 'dbd', fullAccess }) as AdminJwtPayload;

  it('allows own tenant and null without fullAccess', () => {
    expect(() => assertTenantSlugAllowed(admin(false), 'dbd')).not.toThrow();
    expect(() => assertTenantSlugAllowed(admin(false), null)).not.toThrow();
  });

  it('refuses another tenant without fullAccess', () => {
    expect(() => assertTenantSlugAllowed(admin(false), 'acme')).toThrow(
      ForbiddenException,
    );
  });

  it('allows any tenant with fullAccess', () => {
    expect(() => assertTenantSlugAllowed(admin(true), 'acme')).not.toThrow();
  });
});
