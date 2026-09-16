import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const ClientId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.clientId;
  },
);

/**
 * Extracts the creator's external id, as supplied by the caller in the
 * `X-User-Id` header. That header keeps its name: it carries the id of a creator
 * in the *calling* system, which FileHarbor stores as a Creator — the owner of
 * the content, who never authenticates here.
 */
export const CreatorExternalId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.externalCreatorId;
  },
);
