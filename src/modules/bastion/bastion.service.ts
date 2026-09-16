import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TokenResponse } from './bastion.types';

/**
 * HTTP client for FileHarbor's *outgoing* calls to Bastion: obtaining a
 * service-client token and writing audit events. Nothing to do with verifying
 * incoming tokens, which lives in `BastionJwksService`.
 */
@Injectable()
export class BastionService {
  constructor(private readonly config: ConfigService) {}

  private get base(): string {
    return this.config.get<string>('bastionUrl') ?? 'http://localhost:3001';
  }

  private get appSlug(): string {
    return this.config.get<string>('bastionAppSlug') ?? 'fileharbor';
  }

  /** Optional: only sent when the service client is bound to a single tenant. */
  private get tenantSlug(): string | undefined {
    return this.config.get<string>('bastionTenantSlug') || undefined;
  }

  private async call<T>(
    method: string,
    path: string,
    body?: unknown,
    token?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { message?: string };
      throw new HttpException(err.message ?? 'Bastion error', res.status);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** Exchanges the client API key for a service-client JWT (TTL 1h in Bastion). */
  clientAuth(): Promise<TokenResponse> {
    const tenantSlug = this.tenantSlug;
    return this.call<TokenResponse>('POST', '/auth/client', {
      apiKey: this.config.getOrThrow<string>('bastionClientApiKey'),
      serviceSlug: this.appSlug,
      ...(tenantSlug && { tenantSlug }),
    });
  }

  writeAuditEvent(
    accessToken: string,
    data: {
      event: string;
      userId?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<{ id: string; createdAt: string }> {
    return this.call('POST', '/events', data, accessToken);
  }
}
