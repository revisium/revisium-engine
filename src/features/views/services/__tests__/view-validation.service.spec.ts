import { BadRequestException } from '@nestjs/common';
import {
  givenDraftProject,
  givenDraftProjectWithSchema,
} from 'src/__tests__/fixtures/scenarios/given-draft-project';
import { createTestingModule } from 'src/features/draft/commands/handlers/__tests__/utils';
import { ViewValidationService } from 'src/features/views/services/view-validation.service';
import { TableViewsData } from 'src/features/views/types';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import {
  JsonSchemaTypeName,
  type JsonObjectSchema,
} from '@revisium/schema-toolkit/types';

const titleCountSchema: JsonObjectSchema = {
  type: JsonSchemaTypeName.Object,
  properties: {
    title: { type: JsonSchemaTypeName.String, default: '' },
    count: { type: JsonSchemaTypeName.Number, default: 0 },
  },
  additionalProperties: false,
  required: ['title', 'count'],
};

const nestedRewardsSchema: JsonObjectSchema = {
  type: JsonSchemaTypeName.Object,
  properties: {
    rewards: {
      type: JsonSchemaTypeName.Object,
      properties: {
        reputation: {
          type: JsonSchemaTypeName.Object,
          properties: {
            faction: {
              type: JsonSchemaTypeName.String,
              default: '',
            },
            amount: { type: JsonSchemaTypeName.Number, default: 0 },
          },
          additionalProperties: false,
          required: ['faction', 'amount'],
        },
      },
      additionalProperties: false,
      required: ['reputation'],
    },
  },
  additionalProperties: false,
  required: ['rewards'],
};

const titleOnlySchema: JsonObjectSchema = {
  type: JsonSchemaTypeName.Object,
  properties: {
    title: { type: JsonSchemaTypeName.String, default: '' },
  },
  additionalProperties: false,
  required: ['title'],
};

describe('ViewValidationService', () => {
  describe('validateViewsFields', () => {
    describe('valid fields', () => {
      it('should accept system fields (id, createdAt, updatedAt)', async () => {
        const { draftRevisionId, tableId } =
          await givenDraftProject(prismaService);

        const viewsData: TableViewsData = {
          version: 1,
          defaultViewId: 'default',
          views: [
            {
              id: 'default',
              name: 'Default',
              columns: [
                { field: 'id' },
                { field: 'createdAt' },
                { field: 'updatedAt' },
              ],
              sorts: [{ field: 'id', direction: 'asc' }],
            },
          ],
        };

        await runInTransaction(async () => {
          await expect(
            viewValidationService.validateViewsFields(
              draftRevisionId,
              tableId,
              viewsData,
            ),
          ).resolves.toBeUndefined();
        });
      });

      it('should accept valid schema fields with data. prefix', async () => {
        const { draftRevisionId, tableId } = await givenDraftProjectWithSchema({
          prismaService,
          schema: titleCountSchema,
        });

        const viewsData: TableViewsData = {
          version: 1,
          defaultViewId: 'default',
          views: [
            {
              id: 'default',
              name: 'Default',
              columns: [
                { field: 'id' },
                { field: 'data.title' },
                { field: 'data.count' },
              ],
              sorts: [{ field: 'data.title', direction: 'asc' }],
            },
          ],
        };

        await runInTransaction(async () => {
          await expect(
            viewValidationService.validateViewsFields(
              draftRevisionId,
              tableId,
              viewsData,
            ),
          ).resolves.toBeUndefined();
        });
      });

      it('should accept nested schema fields', async () => {
        const { draftRevisionId, tableId } = await givenDraftProjectWithSchema({
          prismaService,
          schema: nestedRewardsSchema,
        });

        const viewsData: TableViewsData = {
          version: 1,
          defaultViewId: 'default',
          views: [
            {
              id: 'default',
              name: 'Default',
              columns: [
                { field: 'id' },
                { field: 'data.rewards' },
                { field: 'data.rewards.reputation' },
                { field: 'data.rewards.reputation.faction' },
                { field: 'data.rewards.reputation.amount' },
              ],
              sorts: [
                { field: 'data.rewards.reputation.faction', direction: 'asc' },
              ],
            },
          ],
        };

        await runInTransaction(async () => {
          await expect(
            viewValidationService.validateViewsFields(
              draftRevisionId,
              tableId,
              viewsData,
            ),
          ).resolves.toBeUndefined();
        });
      });

      it('should accept empty columns and sorts', async () => {
        const { draftRevisionId, tableId } =
          await givenDraftProject(prismaService);

        const viewsData: TableViewsData = {
          version: 1,
          defaultViewId: 'default',
          views: [
            {
              id: 'default',
              name: 'Default',
              columns: [],
              sorts: [],
            },
          ],
        };

        await runInTransaction(async () => {
          await expect(
            viewValidationService.validateViewsFields(
              draftRevisionId,
              tableId,
              viewsData,
            ),
          ).resolves.toBeUndefined();
        });
      });

      it('should accept null columns (default columns)', async () => {
        const { draftRevisionId, tableId } =
          await givenDraftProject(prismaService);

        const viewsData: TableViewsData = {
          version: 1,
          defaultViewId: 'default',
          views: [
            {
              id: 'default',
              name: 'Default',
              columns: null,
              sorts: [],
            },
          ],
        };

        await runInTransaction(async () => {
          await expect(
            viewValidationService.validateViewsFields(
              draftRevisionId,
              tableId,
              viewsData,
            ),
          ).resolves.toBeUndefined();
        });
      });
    });

    describe('invalid fields', () => {
      it('should throw error for non-existent schema field in columns', async () => {
        const { draftRevisionId, tableId } =
          await givenDraftProject(prismaService);

        const viewsData: TableViewsData = {
          version: 1,
          defaultViewId: 'default',
          views: [
            {
              id: 'default',
              name: 'Default',
              columns: [{ field: 'id' }, { field: 'data.nonExistentField' }],
            },
          ],
        };

        await runInTransaction(async () => {
          await expect(
            viewValidationService.validateViewsFields(
              draftRevisionId,
              tableId,
              viewsData,
            ),
          ).rejects.toThrow(BadRequestException);
        });
      });

      it('should throw error for non-existent schema field in sorts', async () => {
        const { draftRevisionId, tableId } =
          await givenDraftProject(prismaService);

        const viewsData: TableViewsData = {
          version: 1,
          defaultViewId: 'default',
          views: [
            {
              id: 'default',
              name: 'Default',
              sorts: [{ field: 'data.nonExistentField', direction: 'asc' }],
            },
          ],
        };

        await runInTransaction(async () => {
          await expect(
            viewValidationService.validateViewsFields(
              draftRevisionId,
              tableId,
              viewsData,
            ),
          ).rejects.toThrow(BadRequestException);
        });
      });

      it('should throw error for field without data. prefix', async () => {
        const { draftRevisionId, tableId } = await givenDraftProjectWithSchema({
          prismaService,
          schema: titleOnlySchema,
        });

        const viewsData: TableViewsData = {
          version: 1,
          defaultViewId: 'default',
          views: [
            {
              id: 'default',
              name: 'Default',
              columns: [
                { field: 'id' },
                { field: 'title' }, // Missing data. prefix
              ],
            },
          ],
        };

        await runInTransaction(async () => {
          await expect(
            viewValidationService.validateViewsFields(
              draftRevisionId,
              tableId,
              viewsData,
            ),
          ).rejects.toThrow(BadRequestException);
        });
      });

      it('should throw error for invalid field in filters', async () => {
        const { draftRevisionId, tableId } =
          await givenDraftProject(prismaService);

        const viewsData: TableViewsData = {
          version: 1,
          defaultViewId: 'default',
          views: [
            {
              id: 'default',
              name: 'Default',
              filters: {
                logic: 'and',
                conditions: [
                  {
                    field: 'data.nonExistentField',
                    operator: 'equals',
                    value: 'test',
                  },
                ],
              },
            },
          ],
        };

        await runInTransaction(async () => {
          await expect(
            viewValidationService.validateViewsFields(
              draftRevisionId,
              tableId,
              viewsData,
            ),
          ).rejects.toThrow(BadRequestException);
        });
      });

      it('should throw error for invalid field in nested filter groups', async () => {
        const { draftRevisionId, tableId } =
          await givenDraftProject(prismaService);

        const viewsData: TableViewsData = {
          version: 1,
          defaultViewId: 'default',
          views: [
            {
              id: 'default',
              name: 'Default',
              filters: {
                logic: 'and',
                conditions: [],
                groups: [
                  {
                    logic: 'or',
                    conditions: [
                      {
                        field: 'data.invalidNestedField',
                        operator: 'equals',
                        value: 'test',
                      },
                    ],
                  },
                ],
              },
            },
          ],
        };

        await runInTransaction(async () => {
          await expect(
            viewValidationService.validateViewsFields(
              draftRevisionId,
              tableId,
              viewsData,
            ),
          ).rejects.toThrow(BadRequestException);
        });
      });

      it('should include all invalid fields in error message', async () => {
        const { draftRevisionId, tableId } =
          await givenDraftProject(prismaService);

        const viewsData: TableViewsData = {
          version: 1,
          defaultViewId: 'default',
          views: [
            {
              id: 'default',
              name: 'Default',
              columns: [{ field: 'data.invalid1' }, { field: 'data.invalid2' }],
              sorts: [{ field: 'data.invalid3', direction: 'asc' }],
            },
          ],
        };

        await runInTransaction(async () => {
          await expect(
            viewValidationService.validateViewsFields(
              draftRevisionId,
              tableId,
              viewsData,
            ),
          ).rejects.toThrow(/invalid1/i);

          await expect(
            viewValidationService.validateViewsFields(
              draftRevisionId,
              tableId,
              viewsData,
            ),
          ).rejects.toThrow(/invalid2/i);

          await expect(
            viewValidationService.validateViewsFields(
              draftRevisionId,
              tableId,
              viewsData,
            ),
          ).rejects.toThrow(/invalid3/i);
        });
      });
    });

    describe('multiple views', () => {
      it('should validate fields across all views', async () => {
        const { draftRevisionId, tableId } =
          await givenDraftProject(prismaService);

        const viewsData: TableViewsData = {
          version: 1,
          defaultViewId: 'default',
          views: [
            {
              id: 'default',
              name: 'Default',
              columns: [{ field: 'id' }],
            },
            {
              id: 'custom',
              name: 'Custom',
              columns: [{ field: 'data.invalidField' }],
            },
          ],
        };

        await runInTransaction(async () => {
          await expect(
            viewValidationService.validateViewsFields(
              draftRevisionId,
              tableId,
              viewsData,
            ),
          ).rejects.toThrow(BadRequestException);
        });
      });
    });
  });

  async function runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return transactionPrismaService.run(fn);
  }

  let viewValidationService: ViewValidationService;
  let prismaService: PrismaService;
  let transactionPrismaService: TransactionPrismaService;

  beforeAll(async () => {
    const result = await createTestingModule();
    prismaService = result.prismaService;
    transactionPrismaService = result.transactionService;
    viewValidationService = result.module.get(ViewValidationService);
  });

  afterAll(async () => {
    await prismaService.$disconnect();
  });
});
