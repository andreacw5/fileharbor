import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client as PgClient } from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL as string,
      // pg defaults to 10; stats fan out ~13 queries at once and uploads/jobs share the pool
      max: Number(process.env.DATABASE_POOL_MAX) || 20,
    });
    super({ adapter });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Database connected successfully');
    } catch (error) {
      this.logger.error(
        'Failed to connect to database',
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  /**
   * Runs a scheduled job only if no other instance is running it: a session-level
   * `pg_try_advisory_lock` on a dedicated connection (pooled connections would
   * lock and unlock on different sessions). If the process dies the connection
   * drops and Postgres releases the lock. Returns false when the job was skipped.
   */
  async runExclusive(
    job: string,
    fn: () => Promise<unknown>,
  ): Promise<boolean> {
    const conn = new PgClient({ connectionString: process.env.DATABASE_URL });
    // An idle client that loses its socket emits 'error'; unhandled, it kills the process
    conn.on('error', (err) =>
      this.logger.warn(`Job ${job} lock connection lost: ${err.message}`),
    );
    try {
      await conn.connect();
    } catch (error) {
      this.logger.error(`Job ${job} skipped, no lock connection`, error.stack);
      await conn.end().catch(() => {});
      return false;
    }
    try {
      const { rows } = await conn.query(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
        [job],
      );
      if (!rows[0].locked) {
        this.logger.debug(`Job ${job} already running elsewhere, skipped`);
        return false;
      }
      await fn();
      return true;
    } finally {
      await conn.end(); // ending the session releases the lock
    }
  }

  async onModuleDestroy() {
    try {
      await this.$disconnect();
      this.logger.log('Database disconnected successfully');
    } catch (error) {
      this.logger.error(
        'Failed to disconnect from database',
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }
}
