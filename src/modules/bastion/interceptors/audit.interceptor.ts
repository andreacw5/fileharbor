import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditActor, BastionAuditService } from '../bastion-audit.service';
import {
  AUDIT_EVENT_KEY,
  AuditDescriptor,
  AuditRequest,
} from '../decorators/audit.decorator';

interface RequestWithAdminUser extends AuditRequest {
  adminUser?: AuditActor;
}

/**
 * Writes an event to Bastion's audit log after the handler has responded,
 * without ever affecting the request it is tracking:
 *
 * - `tap()`, never `map()` — the response is not touched.
 * - No `await` on the write: fire-and-forget. `writeAsAdmin()` never rejects in
 *   practice (it absorbs even a failed token fetch), but a `.catch()` stays here
 *   as a defence: without it a rejected promise on a "void" call would become an
 *   unhandled rejection able to take the process down, not merely fail the
 *   request.
 * - The metadata builder runs in a try/catch: an error in it must never
 *   propagate into the response.
 * - Actor attribution (userId vs fallback metadata) is already handled by
 *   `writeAsAdmin()`: there is no tenant logic here.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: BastionAuditService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const descriptor = this.reflector.get<AuditDescriptor | undefined>(
      AUDIT_EVENT_KEY,
      ctx.getHandler(),
    );
    if (!descriptor) return next.handle();

    const req = ctx.switchToHttp().getRequest<RequestWithAdminUser>();

    return next.handle().pipe(
      tap((result) => {
        try {
          const metadata = descriptor.options.metadata?.(result, req) ?? {};
          this.audit
            .writeAsAdmin(descriptor.event, req.adminUser, metadata)
            .catch((err: Error) =>
              this.logger.warn(
                `audit write failed event=${descriptor.event}`,
                err?.message,
              ),
            );
        } catch (err) {
          this.logger.warn(
            `audit metadata builder failed event=${descriptor.event}`,
            (err as Error)?.message,
          );
        }
      }),
    );
  }
}
