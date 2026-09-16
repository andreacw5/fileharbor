import { SetMetadata } from '@nestjs/common';

export const AUDIT_EVENT_KEY = 'audit:event';

export interface AuditRequest {
  params: Record<string, string>;
  body: unknown;
}

export interface AuditOptions {
  /** Builds the metadata from response + request. Must already be redacted. */
  metadata?: (result: unknown, req: AuditRequest) => Record<string, unknown>;
}

export interface AuditDescriptor {
  event: string;
  options: AuditOptions;
}

/**
 * Marks an admin handler for an automatic write to Bastion's audit log via
 * `AuditInterceptor`. The actor is resolved by the interceptor through
 * `BastionAuditService.writeAsAdmin()` — here you only declare the event name
 * and how to build the metadata from the response.
 *
 * Event name: Bastion's regex is `^[a-z0-9_]+\.[a-z0-9_]+$` — exactly two
 * segments (e.g. `fh_image.deleted`, not `fh.image.deleted`).
 *
 * Never put a token, an API key or a full request body in the metadata.
 */
export const Audit = (event: string, options: AuditOptions = {}) =>
  SetMetadata(AUDIT_EVENT_KEY, { event, options } satisfies AuditDescriptor);
