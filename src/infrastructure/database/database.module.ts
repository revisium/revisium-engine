import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { BranchWriteFenceService } from 'src/infrastructure/database/branch-write-fence.service';
import { CleanupService } from 'src/infrastructure/database/cleanup.service';
import { EscalatingTransactionRunner } from 'src/infrastructure/database/escalating-transaction-runner';
import { HashService } from 'src/infrastructure/database/hash.service';
import { IdService } from 'src/infrastructure/database/id.service';
import { OperationTransactionRunner } from 'src/infrastructure/database/operation-transaction-runner';
import { PostgresqlNotificationService } from 'src/infrastructure/database/postgresql-notification.service';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import { TransactionTimeoutSupport } from 'src/infrastructure/database/transaction-timeout-support';

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
    EscalatingTransactionRunner,
    TransactionTimeoutSupport,
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
    EscalatingTransactionRunner,
    OperationTransactionRunner,
  ],
})
export class DatabaseModule {}
