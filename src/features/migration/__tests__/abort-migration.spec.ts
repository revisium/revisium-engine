import { BadRequestException } from '@nestjs/common';
import type { MigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { createMigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { AbortMigrationCommand } from 'src/features/migration/commands/impl/abort-migration.command';
import { MigrationStatus } from 'src/features/migration/types/migration.types';
import { prepareBranch } from 'src/__tests__/utils/prepareProject';

describe('AbortMigrationHandler', () => {
  let kit: MigrationTestKit;

  beforeAll(async () => {
    kit = await createMigrationTestKit();
  });

  afterAll(async () => {
    if (kit) {
      await kit.close();
    }
  });

  it('should cancel a PENDING migration', async () => {
    const { draftRevisionId } = await prepareBranch(kit.prisma);

    const migration = await kit.prisma.tableMigration.create({
      data: {
        revisionId: draftRevisionId,
        tableId: 'test-table',
        sourceTableVersionId: 'source-v1',
        status: MigrationStatus.PENDING,
        phase: 'INIT',
        patches: [],
        previousSchema: {},
        previousSchemaHash: 'hash1',
        targetSchemaHash: 'hash2',
        totalRows: 500,
      },
    });

    await kit.commandBus.execute(
      new AbortMigrationCommand({
        revisionId: draftRevisionId,
        tableId: 'test-table',
      }),
    );

    const updated = await kit.prisma.tableMigration.findUnique({
      where: {
        revisionId_tableId: {
          revisionId: migration.revisionId,
          tableId: migration.tableId,
        },
      },
    });
    expect(updated).toBeNull();
  });

  it('should cancel a COPYING migration', async () => {
    const { draftRevisionId } = await prepareBranch(kit.prisma);

    await kit.prisma.tableMigration.create({
      data: {
        revisionId: draftRevisionId,
        tableId: 'test-table',
        sourceTableVersionId: 'source-v1',
        status: MigrationStatus.COPYING,
        phase: 'COPYING',
        patches: [],
        previousSchema: {},
        previousSchemaHash: 'hash1',
        targetSchemaHash: 'hash2',
        totalRows: 1000,
        copiedRows: 300,
      },
    });

    await kit.commandBus.execute(
      new AbortMigrationCommand({
        revisionId: draftRevisionId,
        tableId: 'test-table',
      }),
    );

    const updated = await kit.prisma.tableMigration.findUnique({
      where: {
        revisionId_tableId: {
          revisionId: draftRevisionId,
          tableId: 'test-table',
        },
      },
    });
    expect(updated).toBeNull();
  });

  it('should throw error when aborting during SWAPPING phase', async () => {
    const { draftRevisionId } = await prepareBranch(kit.prisma);

    await kit.prisma.tableMigration.create({
      data: {
        revisionId: draftRevisionId,
        tableId: 'test-table',
        sourceTableVersionId: 'source-v1',
        status: MigrationStatus.SWAPPING,
        phase: 'SWAPPING',
        patches: [],
        previousSchema: {},
        previousSchemaHash: 'hash1',
        targetSchemaHash: 'hash2',
        totalRows: 500,
      },
    });

    await expect(
      kit.commandBus.execute(
        new AbortMigrationCommand({
          revisionId: draftRevisionId,
          tableId: 'test-table',
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('should throw error when migration is already completed', async () => {
    const { draftRevisionId } = await prepareBranch(kit.prisma);

    await kit.prisma.tableMigration.create({
      data: {
        revisionId: draftRevisionId,
        tableId: 'test-table',
        sourceTableVersionId: 'source-v1',
        status: MigrationStatus.COMPLETED,
        phase: 'DONE',
        patches: [],
        previousSchema: {},
        previousSchemaHash: 'hash1',
        targetSchemaHash: 'hash2',
        totalRows: 500,
        copiedRows: 500,
      },
    });

    await expect(
      kit.commandBus.execute(
        new AbortMigrationCommand({
          revisionId: draftRevisionId,
          tableId: 'test-table',
        }),
      ),
    ).rejects.toThrow(/already completed/);
  });

  it('should return without error when no migration exists', async () => {
    const { draftRevisionId } = await prepareBranch(kit.prisma);

    await expect(
      kit.commandBus.execute(
        new AbortMigrationCommand({
          revisionId: draftRevisionId,
          tableId: 'nonexistent-table',
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
