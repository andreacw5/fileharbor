/**
 * Writes the OpenAPI document to a file without a database or a listening port:
 * `pnpm openapi:dump [out.json]` (default `openapi.json`). Consumed by
 * `@heyatom/client`'s `gen:types`. Nest only instantiates providers here, it never
 * runs `onModuleInit`, so Prisma does not connect; dummy values satisfy the
 * env validation when no `.env` is present.
 */
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { createOpenApiDocument } from '@heyatom/nest-common';

process.env.DATABASE_URL ??= 'postgresql://openapi:dump@localhost:5432/openapi';

async function dump(out: string) {
  const { AppModule } = require('../src/modules/app/app.module') as typeof import('../src/modules/app/app.module');
  const { SWAGGER_OPTIONS } = require('../src/common/openapi') as typeof import('../src/common/openapi');
  const app = await NestFactory.create(AppModule, { logger: false });
  writeFileSync(out, JSON.stringify(createOpenApiDocument(app, SWAGGER_OPTIONS), null, 2) + '\n');
  await app.close();
}

dump(process.argv[2] ?? 'openapi.json').catch((err) => {
  console.error(err);
  process.exit(1);
});
