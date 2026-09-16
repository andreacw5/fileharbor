import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decodeJwt } from 'jose';
import { BastionService } from './bastion.service';

/** Renew the token when less than this is left before expiry. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const TOKEN_FALLBACK_TTL_MS = 60 * 60 * 1000;

/**
 * The parts of an actor this service needs. Both `AdminJwtPayload` and a raw
 * `UserJwtPayload` satisfy it, so the interceptor can pass whichever it holds.
 */
export interface AuditActor {
  sub: string;
  tenantId?: string;
  tenantSlug?: string;
  role?: string;
  appSlug?: string;
}

@Injectable()
export class BastionAuditService implements OnModuleInit {
  private readonly logger = new Logger(BastionAuditService.name);
  private token: string | null = null;
  private expiresAt = 0;
  /** tenantId of the service client, read from its token. Bastion accepts
   *  `userId` only for users of this tenant. */
  private tenantId: string | null = null;
  private tenantMismatchWarned = false;

  constructor(
    private readonly bastion: BastionService,
    private readonly config: ConfigService,
  ) {}

  /**
   * With no `BASTION_CLIENT_API_KEY` there is no service client to
   * authenticate as, so every write would fail identically. Checked once here
   * rather than per event: a deployment without the key logs a single warning
   * instead of one error per admin action.
   */
  private get enabled(): boolean {
    return Boolean(this.config.get<string>('bastionClientApiKey'));
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.warn(
        'BASTION_CLIENT_API_KEY not set — admin audit events will not be written to Bastion',
      );
      return;
    }
    await this.ensureToken().catch((err: Error) =>
      this.logger.error(
        `Bastion unreachable at startup, will retry on first write: ${err.message}`,
      ),
    );
  }

  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
      return this.token;
    }
    const { accessToken } = await this.bastion.clientAuth();
    const { exp, tenantId } = decodeJwt(accessToken) as {
      exp?: number;
      tenantId?: string;
    };
    this.token = accessToken;
    this.expiresAt = exp ? exp * 1000 : Date.now() + TOKEN_FALLBACK_TTL_MS;
    this.tenantId = tenantId ?? null;
    this.logger.log('service client token refreshed');
    return this.token;
  }

  /**
   * Never rejects: callers use it fire-and-forget (`void write(...)`), and an
   * audit must not be able to fail the operation it is tracking, nor produce an
   * unhandled rejection when Bastion is unreachable. Both the token fetch and
   * the write are absorbed and logged.
   */
  async write(
    event: string,
    opts: { userId?: string; metadata?: Record<string, unknown> } = {},
  ): Promise<void> {
    if (!this.enabled) return;

    let token: string;
    try {
      token = await this.ensureToken();
    } catch (err) {
      this.logger.error(
        `audit write skipped, no service client token event=${event}`,
        (err as Error)?.message,
      );
      return;
    }
    await this.bastion
      .writeAuditEvent(token, { event, ...opts })
      .catch((err: Error) =>
        this.logger.error(`audit write failed event=${event}`, err?.message),
      );
  }

  /**
   * Writes an event attributed to an admin user.
   *
   * Bastion accepts the `userId` field only when that User belongs to the
   * calling service client's tenant: with different tenants the whole write
   * fails with `400 User does not exist in this tenant` and the event is lost.
   * The actor's tenant is compared against the one read from the token before
   * deciding where the identity goes:
   *
   * - same tenant      → `userId` set, native Bastion attribution
   * - different tenant → identity in the metadata (`actorId`/`actorRole`/`actorAppSlug`),
   *   so the event stays writable and keeps the "who"
   *
   * The second case is a configuration to fix, not a way to operate: it is
   * logged as a warning once per process lifetime.
   */
  async writeAsAdmin(
    event: string,
    actor: AuditActor | undefined,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    if (!this.enabled) return;

    // populates this.tenantId before the comparison
    await this.ensureToken().catch(() => undefined);

    const sameTenant =
      Boolean(actor?.sub) &&
      Boolean(this.tenantId) &&
      actor?.tenantId === this.tenantId;

    if (sameTenant && actor) {
      return this.write(event, { userId: actor.sub, metadata });
    }

    if (actor && !this.tenantMismatchWarned) {
      this.tenantMismatchWarned = true;
      this.logger.warn(
        `admin tenant (${actor.tenantSlug ?? actor.tenantId ?? 'none'}) differs from ` +
          `fileharbor service-client tenant (${this.tenantId ?? 'unknown'}) — ` +
          'audit events fall back to actor metadata instead of userId',
      );
    }

    return this.write(event, {
      metadata: {
        ...metadata,
        actorId: actor?.sub ?? 'unknown',
        actorRole: actor?.role ?? 'unknown',
        actorAppSlug: actor?.appSlug ?? 'unknown',
      },
    });
  }
}
