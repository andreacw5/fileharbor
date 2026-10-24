import type { BastionAuditService } from '@heyatom/bastion-client/nest';

/**
 * Audit of a client-surface (X-API-Key) write. Never awaited: an audit must not
 * fail the request. Called from the client controllers, not the services, which
 * the already-audited admin routes share.
 */
export function auditClientWrite(
  audit: BastionAuditService,
  event: string,
  clientId: string,
  externalUserId: string | undefined,
  metadata: Record<string, unknown>,
): void {
  void audit.write(event, {
    metadata: {
      via: 'api_key',
      clientId,
      externalUserId: externalUserId ?? null,
      ...metadata,
    },
  });
}
