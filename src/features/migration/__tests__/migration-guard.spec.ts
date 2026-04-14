import { HttpStatus } from '@nestjs/common';
import {
  getObjectSchema,
  getNumberSchema,
} from '@revisium/schema-toolkit/mocks';
import { JsonSchemaTypeName } from '@revisium/schema-toolkit/types';
import type { MigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { createMigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { givenDraftProject } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { MigrationLockedException } from 'src/features/migration/exceptions/migration-locked.exception';
import { MigrationStatus } from 'src/features/migration/types/migration.types';

describe('Migration Guard (integration)', () => {
  let kit: MigrationTestKit;

  beforeAll(async () => {
    kit = await createMigrationTestKit();
  });

  afterAll(async () => {
    if (kit) {
      await kit.close();
    }
  });

  async function createActiveMigration(draftRevisionId: string) {
    return kit.prisma.tableMigration.create({
      data: {
        revisionId: draftRevisionId,
        tableId: 'migrating-table',
        sourceTableVersionId: 'source-v1',
        status: MigrationStatus.COPYING,
        phase: 'COPYING',
        patches: [],
        previousSchema: {},
        previousSchemaHash: 'hash1',
        targetSchemaHash: 'hash2',
        totalRows: 1000,
        copiedRows: 500,
      },
    });
  }

  it('apiCreateRow should return 423 during active migration', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(kit.prisma);
    await createActiveMigration(draftRevisionId);

    await expect(
      kit.draftApi.apiCreateRow({
        revisionId: draftRevisionId,
        tableId,
        rowId: 'new-row',
        data: { ver: 1 },
      }),
    ).rejects.toThrow(MigrationLockedException);
  });

  it('apiUpdateRow should return 423 during active migration', async () => {
    const { draftRevisionId, tableId, rowId } = await givenDraftProject(
      kit.prisma,
    );
    await createActiveMigration(draftRevisionId);

    await expect(
      kit.draftApi.apiUpdateRow({
        revisionId: draftRevisionId,
        tableId,
        rowId,
        data: { ver: 99 },
      }),
    ).rejects.toThrow(MigrationLockedException);
  });

  it('apiCreateTable should return 423 during active migration', async () => {
    const { draftRevisionId } = await givenDraftProject(kit.prisma);
    await createActiveMigration(draftRevisionId);

    await expect(
      kit.draftApi.apiCreateTable({
        revisionId: draftRevisionId,
        tableId: 'new-table',
        schema: getObjectSchema({ name: getNumberSchema() }),
      }),
    ).rejects.toThrow(MigrationLockedException);
  });

  it('apiUpdateTable should return 423 during active migration', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(kit.prisma);
    await createActiveMigration(draftRevisionId);

    await expect(
      kit.draftApi.apiUpdateTable({
        revisionId: draftRevisionId,
        tableId,
        patches: [
          {
            op: 'replace',
            path: '/properties/ver',
            value: { type: JsonSchemaTypeName.String, default: '' },
          },
        ],
      }),
    ).rejects.toThrow(MigrationLockedException);
  });

  it('apiRemoveRow should return 423 during active migration', async () => {
    const { draftRevisionId, tableId, rowId } = await givenDraftProject(
      kit.prisma,
    );
    await createActiveMigration(draftRevisionId);

    await expect(
      kit.draftApi.apiRemoveRow({
        revisionId: draftRevisionId,
        tableId,
        rowId,
      }),
    ).rejects.toThrow(MigrationLockedException);
  });

  it('apiRemoveTable should return 423 during active migration', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(kit.prisma);
    await createActiveMigration(draftRevisionId);

    await expect(
      kit.draftApi.apiRemoveTable({
        revisionId: draftRevisionId,
        tableId,
      }),
    ).rejects.toThrow(MigrationLockedException);
  });

  it('apiRenameRow should return 423 during active migration', async () => {
    const { draftRevisionId, tableId, rowId } = await givenDraftProject(
      kit.prisma,
    );
    await createActiveMigration(draftRevisionId);

    await expect(
      kit.draftApi.apiRenameRow({
        revisionId: draftRevisionId,
        tableId,
        rowId,
        nextRowId: 'renamed-row',
      }),
    ).rejects.toThrow(MigrationLockedException);
  });

  it('apiRenameTable should return 423 during active migration', async () => {
    const { draftRevisionId, tableId } = await givenDraftProject(kit.prisma);
    await createActiveMigration(draftRevisionId);

    await expect(
      kit.draftApi.apiRenameTable({
        revisionId: draftRevisionId,
        tableId,
        nextTableId: 'renamed-table',
      }),
    ).rejects.toThrow(MigrationLockedException);
  });

  it('MigrationLockedException should have status 423', () => {
    const error = new MigrationLockedException({
      migrationId: 'test',
      tableId: 'table',
      status: 'COPYING',
      progress: { percentage: 50, copiedRows: 500, totalRows: 1000 },
    });

    expect(error.getStatus()).toBe(HttpStatus.LOCKED);
  });
});
