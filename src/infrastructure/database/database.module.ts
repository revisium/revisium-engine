import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { BranchWriteFenceService } from 'src/infrastructure/database/branch-write-fence.service';
import { CleanupService } from 'src/infrastructure/database/cleanup.service';
import { HashService } from 'src/infrastructure/database/hash.service';
import { IdService } from 'src/infrastructure/database/id.service';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';
import { PostgresqlNotificationService } from 'src/infrastructure/database/postgresql-notification.service';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@Module({
  imports: [ConfigModule, CqrsModule],
  providers: [
    PrismaService,
    PostgresqlNotificationService,
    IdService,
    TransactionPrismaService,
    HashService,
    CleanupService,
    BranchWriteFenceService,
    OperationTransactionRunner,
  ],
  exports: [
    PrismaService,
    PostgresqlNotificationService,
    IdService,
    TransactionPrismaService,
    HashService,
    CleanupService,
    BranchWriteFenceService,
    OperationTransactionRunner,
  ],
})
export class DatabaseModule {}
