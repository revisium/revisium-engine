import { JsonSchemaTypeName } from '@revisium/schema-toolkit/types';
import {
  expectDraftSchemaToHaveProperties,
  expectMigrationToFinish,
  getDraftSchemaData,
} from 'src/__tests__/assertions/migration';
import {
  MigrationStatus,
  MigrationPhase,
} from 'src/features/migration/types/migration.types';
import { createMigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';
import { givenDraftWithRows } from 'src/__tests__/fixtures/scenarios/given-draft-with-rows';
import type { MigrationTestKit } from 'src/__tests__/kit/create-migration-test-kit';

const TEST_THRESHOLD = 10;
const ROW_COUNT = 15;

const testSchema = {
  type: JsonSchemaTypeName.Object as const,
  required: ['ver'],
  properties: {
    ver: { type: JsonSchemaTypeName.Number as const, default: 0 },
  },
  additionalProperties: false as const,
};

describe('Migration bugs', () => {
  let kit: MigrationTestKit;

  describe('Bug: @@unique prevents second migration (major 1)', () => {
    it('should allow a second async migration after first completes', async () => {
      const draft = await givenDraftWithRows({
        prisma: kit.prisma,
        schema: testSchema,
        rowCount: ROW_COUNT,
        rows: (index) => ({ ver: index }),
      });

      const result1 = await kit.draftApi.apiUpdateTable({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        patches: [
          {
            op: 'add',
            path: '/properties/field1',
            value: { type: JsonSchemaTypeName.String, default: '' },
          },
        ],
      });
      expect(result1.migrationId).toBeDefined();
      await expectMigrationToFinish(kit, draft.draftRevisionId, draft.tableId);

      const result2 = await kit.draftApi.apiUpdateTable({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        patches: [
          {
            op: 'add',
            path: '/properties/field2',
            value: { type: JsonSchemaTypeName.String, default: '' },
          },
        ],
      });
      expect(result2.migrationId).toBeDefined();

      await expectMigrationToFinish(kit, draft.draftRevisionId, draft.tableId);
    });
  });

  describe('Bug: retry re-creates shadow table (critical 2)', () => {
    it('should reuse existing shadow table on retry', async () => {
      const draft = await givenDraftWithRows({
        prisma: kit.prisma,
        schema: testSchema,
        rowCount: ROW_COUNT,
        rows: (index) => ({ ver: index }),
      });

      const shadowVersionId = 'shadow-already-exists-' + Date.now();
      await kit.prisma.table.create({
        data: {
          versionId: shadowVersionId,
          createdId: 'created-1',
          id: draft.tableId,
          readonly: false,
          system: false,
        },
      });

      await kit.prisma.tableMigration.create({
        data: {
          revisionId: draft.draftRevisionId,
          tableId: draft.tableId,
          sourceTableVersionId: draft.draftTableVersionId,
          shadowTableVersionId: shadowVersionId,
          status: MigrationStatus.PENDING,
          phase: MigrationPhase.COPYING,
          patches: [],
          previousSchema: testSchema,
          previousSchemaHash: 'h1',
          targetSchemaHash: 'h2',
          totalRows: ROW_COUNT,
          copiedRows: 0,
        },
      });

      const spy = jest.spyOn(
        kit.migrationProgressService,
        'setShadowTableVersionId',
      );

      try {
        await kit.migrationService.processMigration(
          (
            await kit.prisma.tableMigration.findFirst({
              where: {
                revisionId: draft.draftRevisionId,
                tableId: draft.tableId,
              },
            })
          )?.id ?? '',
        );
      } catch {
        // may fail on validate/swap — that's ok, we're testing initPhase
      }

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('Bug: schema not atomic with migration record (critical 1)', () => {
    it('should not update schema if migration record creation fails', async () => {
      const draft = await givenDraftWithRows({
        prisma: kit.prisma,
        schema: testSchema,
        rowCount: ROW_COUNT,
        rows: (index) => ({ ver: index }),
      });

      const schemaBefore = await getDraftSchemaData(
        kit,
        draft.draftRevisionId,
        draft.tableId,
      );

      jest
        .spyOn(kit.migrationService, 'createMigrationRecord')
        .mockRejectedValueOnce(new Error('DB write failed'));

      try {
        await kit.draftApi.apiUpdateTable({
          revisionId: draft.draftRevisionId,
          tableId: draft.tableId,
          patches: [
            {
              op: 'add',
              path: '/properties/atomicField',
              value: { type: JsonSchemaTypeName.String, default: '' },
            },
          ],
        });
      } catch {
        // expected to throw
      }

      const schemaAfter = await getDraftSchemaData(
        kit,
        draft.draftRevisionId,
        draft.tableId,
      );
      expect(schemaAfter).toEqual(schemaBefore);
    });
  });

  describe('Bug: no row validation in async path (major 2)', () => {
    it('should produce rows with correct schema fields after migration', async () => {
      const draft = await givenDraftWithRows({
        prisma: kit.prisma,
        schema: testSchema,
        rowCount: ROW_COUNT,
        rows: (index) => ({ ver: index }),
      });

      const result = await kit.draftApi.apiUpdateTable({
        revisionId: draft.draftRevisionId,
        tableId: draft.tableId,
        patches: [
          {
            op: 'add',
            path: '/properties/validated',
            value: { type: JsonSchemaTypeName.Number, default: 0 },
          },
        ],
      });
      expect(result.migrationId).toBeDefined();

      await expectMigrationToFinish(kit, draft.draftRevisionId, draft.tableId);

      await expectDraftSchemaToHaveProperties(
        kit,
        draft.draftRevisionId,
        draft.tableId,
        ['validated'],
      );

      for (const rowId of draft.rowIds) {
        const row = await kit.rowApi.getRow({
          revisionId: draft.draftRevisionId,
          tableId: draft.tableId,
          rowId,
        });
        expect(row).not.toBeNull();
        const data = row?.data as Record<string, unknown>;
        expect(data).toHaveProperty('validated');
        expect(typeof data.validated).toBe('number');
      }
    });
  });

  beforeAll(async () => {
    kit = await createMigrationTestKit({
      threshold: TEST_THRESHOLD,
      batchSize: 5,
    });
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await kit.close();
  });
});
