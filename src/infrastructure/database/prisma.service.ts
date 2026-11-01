import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { PrismaClient, Prisma } from 'src/__generated__/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { configurePrisma } from '@revisium/prisma-pg-json';

configurePrisma(Prisma);

// pg-pool opens at most this many connections when its config sets no max.
const PG_POOL_DEFAULT_MAX = 10;

export const DATABASE_POOL_CONFIG = Symbol('DATABASE_POOL_CONFIG');

export interface DatabasePoolConfig {
  connectionString?: string;
  max?: number;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  public readonly connectionPoolSize: number;

  constructor(
    @Optional()
    @Inject(DATABASE_POOL_CONFIG)
    poolConfig: DatabasePoolConfig = {
      connectionString: process.env.DATABASE_URL,
    },
  ) {
    super({ adapter: new PrismaPg(poolConfig) });

    this.connectionPoolSize = poolConfig.max ?? PG_POOL_DEFAULT_MAX;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
