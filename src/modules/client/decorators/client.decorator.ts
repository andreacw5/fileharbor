import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const ClientId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.clientId;
  },
);

/**
 * Extracts the external user ID from X-User-Id header
 * This is the user ID from the client's system, not Fileharbor's internal user ID
 */
export const ExternalUserId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.externalUserId;
  },
);

/**
 * Legacy alias for ExternalUserId - use ExternalUserId instead
 */
export const UserId = ExternalUserId;

export const User = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

