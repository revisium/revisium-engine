import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import type { TransactionPrismaClient } from 'src/features/share/types';
import {
  MigrationPhase,
  MigrationStatus,
} from 'src/features/migration/types/migration.types';

@Injectable()
export class MigrationProgressService {
  constructor(private readonly prisma: PrismaService) {}

  private getClient(client?: TransactionPrismaClient) {
    return client ?? this.prisma;
  }

  async updateProgress(
    migrationId: string,
    data: {
      copiedRows: number;
      lastCopiedRowId: string;
      currentBatch: number;
    },
    client?: TransactionPrismaClient,
  ) {
    await this.getClient(client).tableMigration.update({
      where: { id: migrationId },
      data: {
        copiedRows: data.copiedRows,
        lastCopiedRowId: data.lastCopiedRowId,
        currentBatch: data.currentBatch,
        lastProgressAt: new Date(),
      },
    });
  }

  async setPhase(
    migrationId: string,
    phase: MigrationPhase,
    status?: MigrationStatus,
  ) {
    const updateData: Record<string, unknown> = {
      phase,
      lastProgressAt: new Date(),
    };
    if (status) {
      updateData.status = status;
    }
    if (phase === MigrationPhase.COPYING) {
      updateData.startedAt = new Date();
    }
    if (phase === MigrationPhase.DONE) {
      updateData.completedAt = new Date();
    }
    await this.prisma.tableMigration.update({
      where: { id: migrationId },
      data: updateData,
    });
  }

  async setShadowTableVersionId(
    migrationId: string,
    shadowTableVersionId: string,
    client?: TransactionPrismaClient,
  ) {
    await this.getClient(client).tableMigration.update({
      where: { id: migrationId },
      data: { shadowTableVersionId },
    });
  }

  async setFailed(migrationId: string, errorMessage: string) {
    await this.prisma.tableMigration.update({
      where: { id: migrationId },
      data: {
        status: MigrationStatus.FAILED,
        errorMessage,
        completedAt: new Date(),
        lastProgressAt: new Date(),
      },
    });
  }

  async incrementRetry(migrationId: string) {
    await this.prisma.tableMigration.update({
      where: { id: migrationId },
      data: {
        retryCount: { increment: 1 },
        status: MigrationStatus.PENDING,
        phase: MigrationPhase.INIT,
        errorMessage: null,
        completedAt: null,
        lastProgressAt: new Date(),
      },
    });
  }

  async isCancelled(migrationId: string): Promise<boolean> {
    const migration = await this.prisma.tableMigration.findUnique({
      where: { id: migrationId },
      select: { status: true },
    });
    return !migration || migration.status === MigrationStatus.CANCELLED;
  }
}
