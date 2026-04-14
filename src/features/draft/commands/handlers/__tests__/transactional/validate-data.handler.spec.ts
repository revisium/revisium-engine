import {
  prepareProject,
  prepareTableWithSchema,
} from 'src/__tests__/utils/prepareProject';
import type { DraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';
import { givenDraftProject } from 'src/__tests__/fixtures/scenarios/given-draft-project';
import {
  getArraySchema,
  getObjectSchema,
  getStringSchema,
} from '@revisium/schema-toolkit/mocks';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';
import {
  ValidateDataCommand,
  ValidateDataCommandReturnType,
} from 'src/features/draft/commands/impl/transactional/validate-data.command';
import {
  DataValidationException,
  ForeignKeyRowsNotFoundException,
  ForeignKeyTableNotFoundException,
  ValidationErrorCode,
} from 'src/features/share/exceptions';
import { DraftContextKeys } from 'src/features/draft/draft-context.service';

describe('ValidateDataHandler', () => {
  let kit: DraftTestKit;

  describe('JSON Schema Validation', () => {
    it('should throw DataValidationException for type mismatch', async () => {
      const { draftRevisionId, tableId } = await givenDraftProject(
        kit.prismaService,
      );

      const command = new ValidateDataCommand({
        revisionId: draftRevisionId,
        tableId,
        rows: [{ rowId: 'test-row', data: { ver: '3' } }],
      });

      try {
        await runTransaction(command, draftRevisionId);
        fail('Expected DataValidationException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DataValidationException);
        const response = (error as DataValidationException).getResponse() as {
          code: string;
          details: Array<{ path: string; message: string }>;
          context: { tableId: string; rowId: string };
        };

        expect(response.code).toBe(ValidationErrorCode.INVALID_DATA);
        expect(response.details).toHaveLength(1);
        expect(response.details[0]?.path).toBe('/ver');
        expect(response.details[0]?.message).toBe('must be number');
        expect(response.context.tableId).toBe(tableId);
        expect(response.context.rowId).toBe('test-row');
      }
    });

    it('should throw DataValidationException for missing required property', async () => {
      const { draftRevisionId, tableId } = await givenDraftProject(
        kit.prismaService,
      );

      const command = new ValidateDataCommand({
        revisionId: draftRevisionId,
        tableId,
        rows: [{ rowId: 'test-row', data: {} }],
      });

      try {
        await runTransaction(command, draftRevisionId);
        fail('Expected DataValidationException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(DataValidationException);
        const response = (error as DataValidationException).getResponse() as {
          code: string;
          details: Array<{ path: string; message: string }>;
        };

        expect(response.code).toBe(ValidationErrorCode.INVALID_DATA);
        expect(response.details[0]?.path).toBe('/');
        expect(response.details[0]?.message).toBe(
          'missing required property "ver"',
        );
      }
    });

    it('should pass validation for valid data', async () => {
      const { draftRevisionId, tableId } = await givenDraftProject(
        kit.prismaService,
      );

      const command = new ValidateDataCommand({
        revisionId: draftRevisionId,
        tableId,
        rows: [{ rowId: 'test-row', data: { ver: 1 } }],
      });

      const result = await runTransaction(command, draftRevisionId);
      expect(result.schemaHash).toBeDefined();
    });
  });

  describe('Foreign Key Validation', () => {
    it('should throw ForeignKeyRowsNotFoundException for simple foreign key', async () => {
      const ids = await prepareProject(kit.prismaService);
      const {
        draftRevisionId,
        headRevisionId,
        tableId,
        schemaTableVersionId,
        migrationTableVersionId,
      } = ids;

      const table = await prepareTableWithSchema({
        prismaService: kit.prismaService,
        headRevisionId,
        draftRevisionId,
        schemaTableVersionId,
        migrationTableVersionId,
        schema: getObjectSchema({
          relatedRow: getStringSchema({ foreignKey: tableId }),
        }),
      });

      const command = new ValidateDataCommand({
        revisionId: draftRevisionId,
        tableId: table.tableId,
        rows: [{ rowId: 'test-row', data: { relatedRow: 'non-existent-id' } }],
      });

      try {
        await runTransaction(command, draftRevisionId);
        fail('Expected ForeignKeyRowsNotFoundException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ForeignKeyRowsNotFoundException);
        const response = (
          error as ForeignKeyRowsNotFoundException
        ).getResponse() as {
          code: string;
          details: Array<{
            path: string;
            tableId: string;
            missingRowIds: string[];
          }>;
          context: { tableId: string };
        };

        expect(response.code).toBe(ValidationErrorCode.FOREIGN_KEY_NOT_FOUND);
        expect(response.details).toHaveLength(1);
        expect(response.details[0]?.path).toBe('/relatedRow');
        expect(response.details[0]?.tableId).toBe(tableId);
        expect(response.details[0]?.missingRowIds).toContain('non-existent-id');
        expect(response.context.tableId).toBe(table.tableId);
      }
    });

    it('should report correct path for nested foreign key', async () => {
      const ids = await prepareProject(kit.prismaService);
      const {
        draftRevisionId,
        headRevisionId,
        tableId,
        schemaTableVersionId,
        migrationTableVersionId,
      } = ids;

      const table = await prepareTableWithSchema({
        prismaService: kit.prismaService,
        headRevisionId,
        draftRevisionId,
        schemaTableVersionId,
        migrationTableVersionId,
        schema: getObjectSchema({
          metadata: getObjectSchema({
            userId: getStringSchema({ foreignKey: tableId }),
          }),
        }),
      });

      const command = new ValidateDataCommand({
        revisionId: draftRevisionId,
        tableId: table.tableId,
        rows: [
          {
            rowId: 'test-row',
            data: { metadata: { userId: 'non-existent-user' } },
          },
        ],
      });

      try {
        await runTransaction(command, draftRevisionId);
        fail('Expected ForeignKeyRowsNotFoundException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ForeignKeyRowsNotFoundException);
        const response = (
          error as ForeignKeyRowsNotFoundException
        ).getResponse() as {
          details: Array<{ path: string }>;
        };

        expect(response.details[0]?.path).toBe('/metadata/userId');
      }
    });

    it('should report correct path for foreign key in array', async () => {
      const ids = await prepareProject(kit.prismaService);
      const {
        draftRevisionId,
        headRevisionId,
        tableId,
        schemaTableVersionId,
        migrationTableVersionId,
      } = ids;

      const table = await prepareTableWithSchema({
        prismaService: kit.prismaService,
        headRevisionId,
        draftRevisionId,
        schemaTableVersionId,
        migrationTableVersionId,
        schema: getObjectSchema({
          tags: getArraySchema(getStringSchema({ foreignKey: tableId })),
        }),
      });

      const command = new ValidateDataCommand({
        revisionId: draftRevisionId,
        tableId: table.tableId,
        rows: [{ rowId: 'test-row', data: { tags: ['non-existent-tag'] } }],
      });

      try {
        await runTransaction(command, draftRevisionId);
        fail('Expected ForeignKeyRowsNotFoundException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ForeignKeyRowsNotFoundException);
        const response = (
          error as ForeignKeyRowsNotFoundException
        ).getResponse() as {
          details: Array<{ path: string }>;
        };

        expect(response.details[0]?.path).toBe('/tags/0');
      }
    });

    it('should throw ForeignKeyTableNotFoundException for non-existent table', async () => {
      const ids = await prepareProject(kit.prismaService);
      const {
        draftRevisionId,
        headRevisionId,
        schemaTableVersionId,
        migrationTableVersionId,
      } = ids;

      const table = await prepareTableWithSchema({
        prismaService: kit.prismaService,
        headRevisionId,
        draftRevisionId,
        schemaTableVersionId,
        migrationTableVersionId,
        schema: getObjectSchema({
          ref: getStringSchema({ foreignKey: 'non-existent-table' }),
        }),
      });

      const command = new ValidateDataCommand({
        revisionId: draftRevisionId,
        tableId: table.tableId,
        rows: [{ rowId: 'test-row', data: { ref: 'some-id' } }],
      });

      try {
        await runTransaction(command, draftRevisionId);
        fail('Expected ForeignKeyTableNotFoundException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ForeignKeyTableNotFoundException);
      }
    });

    it('should pass validation for existing foreign key reference', async () => {
      const ids = await prepareProject(kit.prismaService);
      const {
        draftRevisionId,
        headRevisionId,
        tableId,
        rowId,
        schemaTableVersionId,
        migrationTableVersionId,
      } = ids;

      const table = await prepareTableWithSchema({
        prismaService: kit.prismaService,
        headRevisionId,
        draftRevisionId,
        schemaTableVersionId,
        migrationTableVersionId,
        schema: getObjectSchema({
          relatedRow: getStringSchema({ foreignKey: tableId }),
        }),
      });

      const command = new ValidateDataCommand({
        revisionId: draftRevisionId,
        tableId: table.tableId,
        rows: [{ rowId: 'test-row', data: { relatedRow: rowId } }],
      });

      const result = await runTransaction(command, draftRevisionId);
      expect(result.schemaHash).toBeDefined();
    });

    it('should throw error for empty foreign key value', async () => {
      const ids = await prepareProject(kit.prismaService);
      const {
        draftRevisionId,
        headRevisionId,
        tableId,
        schemaTableVersionId,
        migrationTableVersionId,
      } = ids;

      const table = await prepareTableWithSchema({
        prismaService: kit.prismaService,
        headRevisionId,
        draftRevisionId,
        schemaTableVersionId,
        migrationTableVersionId,
        schema: getObjectSchema({
          relatedRow: getStringSchema({ foreignKey: tableId }),
        }),
      });

      const command = new ValidateDataCommand({
        revisionId: draftRevisionId,
        tableId: table.tableId,
        rows: [{ rowId: 'test-row', data: { relatedRow: '' } }],
      });

      try {
        await runTransaction(command, draftRevisionId);
        fail('Expected ForeignKeyRowsNotFoundException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ForeignKeyRowsNotFoundException);
        const response = (
          error as ForeignKeyRowsNotFoundException
        ).getResponse() as {
          code: string;
          details: Array<{
            path: string;
            tableId: string;
            missingRowIds: string[];
          }>;
        };

        expect(response.code).toBe(ValidationErrorCode.FOREIGN_KEY_NOT_FOUND);
        expect(response.details).toHaveLength(1);
        expect(response.details[0]?.path).toBe('/relatedRow');
        expect(response.details[0]?.tableId).toBe(tableId);
        expect(response.details[0]?.missingRowIds).toContain('');
      }
    });
  });

  describe('Multiple Rows Validation', () => {
    it('should validate all rows and collect all errors', async () => {
      const ids = await prepareProject(kit.prismaService);
      const {
        draftRevisionId,
        headRevisionId,
        tableId,
        schemaTableVersionId,
        migrationTableVersionId,
      } = ids;

      const table = await prepareTableWithSchema({
        prismaService: kit.prismaService,
        headRevisionId,
        draftRevisionId,
        schemaTableVersionId,
        migrationTableVersionId,
        schema: getObjectSchema({
          ref: getStringSchema({ foreignKey: tableId }),
        }),
      });

      const command = new ValidateDataCommand({
        revisionId: draftRevisionId,
        tableId: table.tableId,
        rows: [
          { rowId: 'row-1', data: { ref: 'missing-1' } },
          { rowId: 'row-2', data: { ref: 'missing-2' } },
        ],
      });

      try {
        await runTransaction(command, draftRevisionId);
        fail('Expected ForeignKeyRowsNotFoundException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ForeignKeyRowsNotFoundException);
        const response = (
          error as ForeignKeyRowsNotFoundException
        ).getResponse() as {
          details: Array<{ missingRowIds: string[] }>;
        };

        const allMissingIds = response.details.flatMap((d) => d.missingRowIds);
        expect(allMissingIds).toContain('missing-1');
        expect(allMissingIds).toContain('missing-2');
      }
    });
  });

  function runTransaction(
    command: ValidateDataCommand,
    draftRevisionId: string,
  ): Promise<ValidateDataCommandReturnType> {
    return kit.draftContextService.run(() =>
      kit.transactionService.run(async () => {
        kit.draftContextService.setKey(
          DraftContextKeys.DraftRevisionId,
          draftRevisionId,
        );
        return kit.commandBus.execute(command);
      }),
    );
  }

  beforeAll(async () => {
    kit = await createTestingModule();
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (kit) {
      await kit.close();
    }
  });
});
