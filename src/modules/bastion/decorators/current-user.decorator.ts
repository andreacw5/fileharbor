import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { BastionUserPayload } from '../bastion.types';

/**
 * Reads the Bastion end user verified by `BastionSelfServiceGuard`, which leaves
 * it on `req.bastionUser` — deliberately not `req.user`, which nothing sets.
 * Carries no console permission and no client scope; for the console use
 * `@CurrentAdminUser`.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): BastionUserPayload =>
    ctx.switchToHttp().getRequest().bastionUser,
);
