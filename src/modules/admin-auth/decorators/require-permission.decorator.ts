import { SetMetadata } from '@nestjs/common';
import { ConsolePermission } from '../console-permissions';

export const REQUIRE_PERMISSION_KEY = 'console:permission';

/**
 * Declares which console permission a handler needs. Can be put on a controller
 * class (applies to every route) and overridden per handler.
 *
 * `AdminJwtGuard` is fail-closed: a route behind it with no metadata is refused
 * to everyone but SUPER_ADMIN, so a missing decorator shows up as a 403 instead
 * of silently opening the endpoint.
 */
export const RequirePermission = (permission: ConsolePermission) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permission);
