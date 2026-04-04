import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CleanupService } from 'src/infrastructure/database/cleanup.service';
import { HashService } from 'src/infrastructure/database/hash.service';
import { IdService } from 'src/infrastructure/database/id.service';
import { PostgresqlNotificationService } from 'src/infrastructure/database/postgresql-notification.service';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@Module({
  imports: [ConfigModule],
  providers: [
    PrismaService,
    PostgresqlNotificationService,
    IdService,
    TransactionPrismaService,
    HashService,
    CleanupService,
  ],
  exports: [
    PrismaService,
    PostgresqlNotificationService,
    IdService,
    TransactionPrismaService,
    HashService,
    CleanupService,
  ],
})
export class DatabaseModule {}
