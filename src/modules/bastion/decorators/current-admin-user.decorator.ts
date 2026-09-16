import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AdminJwtPayload } from '../bastion.types';

/**
 * Reads the console admin verified by `BastionUserGuard`, which leaves it on
 * `req.adminUser`. Not to be confused with `@CurrentUser`, which exposes the
 * plain end user on the self-service `/me/*` routes.
 */
export const CurrentAdminUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminJwtPayload =>
    ctx.switchToHttp().getRequest().adminUser,
);
