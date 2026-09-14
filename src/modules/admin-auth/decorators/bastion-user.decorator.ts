import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { BastionUserPayload } from '../guards/bastion-user-jwt.guard';

export const BastionUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): BastionUserPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.bastionUser;
  },
);
