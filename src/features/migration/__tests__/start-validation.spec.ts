import { HttpException } from '@nestjs/common';
import {
  getAddPatch,
  getArraySchema,
  getMovePatch,
  getNumberSchema,
  getObjectSchema,
  getRemovePatch,
  getReplacePatch,
  getStringSchema,
  numFormula,
} from '@revisium/schema-toolkit/mocks';
import type { JsonPatch, JsonSchema } from '@revisium/schema-toolkit/types';
import { expectMigrationAbsent } from 'src/__tests__/assertions/migration';
import {
  createMigrationTestKit,
  type MigrationTestKit,
} from 'src/__tests__/kit/create-migration-test-kit';
import type { InputJsonValue } from 'src/engine-prisma-types';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { ViewsApiService } from 'src/features/views/views-api.service';
import {
  replaceDraftSchema,
  replaceSchemaHistory,
  replaceViewsData,
  unlinkTable,
} from './support/migration-database';
import {
  givenDraftOwnedTable,
  productViews,
  startAsyncUpdate,
  type DraftOwnedTable,
} from './support/migration-scenario';

const THRESHOLD = 1;
const ROW_COUNT = THRESHOLD;
const OWNERS_TABLE_ID = 'owners';

interface RefusedUpdate {
  scenario: string;
  check: string;
  refusal: RegExp;
  given?: (table: DraftOwnedTable) => Promise<void>;
  tableId?: string;
  patches: JsonPatch[];
}

interface TableUpdate {
  revisionId: string;
  tableId: string;
  patches: JsonPatch[];
}

interface Refusal {
  type: string;
  message: string;
  response?: unknown;
}

const priceAddition = getAddPatch({
  path: '/properties/price',
  value: getNumberSchema(),
});

describe('Async migration start validates the schema like the synchronous update', () => {
  it.each<RefusedUpdate>([
    {
      scenario: 'AM-33a',
      check: 'an empty patch list',
      refusal: /^Invalid length of patches$/,
      patches: [],
    },
    {
      scenario: 'AM-33b',
      check: 'the JSON Patch schema',
      refusal: /^patches is not valid: /,
      patches: [
        getReplacePatch({
          path: '/properties/ver',
          value: { ...getStringSchema(), unknownKeyword: true } as JsonSchema,
        }),
      ],
    },
    {
      scenario: 'AM-33c',
      check: 'an added value that the target schema no longer holds',
      refusal: /^A table with this name does not exist in the revision$/,
      patches: [
        getAddPatch({
          path: '/properties/ownerId',
          value: getStringSchema({ foreignKey: 'missing-table' }),
        }),
        getRemovePatch({ path: '/properties/ownerId' }),
      ],
    },
    {
      scenario: 'AM-33d',
      check: 'a system table',
      refusal: /^Table is a system table$/,
      tableId: SystemTables.Schema,
      patches: [priceAddition],
    },
    {
      scenario: 'AM-33e',
      check: 'the target schema against the meta-schema',
      refusal: /^schema is not valid: /,
      given: storeSchemaTheMetaSchemaRejects,
      patches: [priceAddition],
    },
    {
      scenario: 'AM-33f',
      check: 'a foreign key whose table is missing',
      refusal: /^A table with this name does not exist in the revision$/,
      given: referenceTableMissingFromTheDraft,
      patches: [priceAddition],
    },
    {
      scenario: 'AM-33g',
      check: 'a formula',
      refusal: /^Formula validation error in field "doubled": /,
      patches: [
        getAddPatch({
          path: '/properties/doubled',
          value: numFormula('missing * 2'),
        }),
      ],
    },
    {
      scenario: 'AM-33h',
      check: 'field names',
      refusal: /^Invalid field names: bad name\./,
      patches: [
        getAddPatch({
          path: '/properties/details',
          value: getObjectSchema({ 'bad name': getStringSchema() }),
        }),
      ],
    },
    {
      scenario: 'AM-33i',
      check: 'the history-patch schema',
      refusal: /^patches is not valid$/,
      given: (table) => replaceSchemaHistory(kit.prisma, table, []),
      patches: [priceAddition],
    },
    {
      scenario: 'AM-33j',
      check: 'a dry run of the views migration',
      refusal: /^Views migration failed for table "products"/,
      given: storeViewsTheMigrationCannotRead,
      patches: [
        getMovePatch({ from: '/properties/ver', path: '/properties/version' }),
      ],
    },
    {
      scenario: 'AM-33',
      check: 'patches the schema cannot apply',
      refusal: /^Not found "missing" in "\/properties"$/,
      patches: [getRemovePatch({ path: '/properties/missing' })],
    },
  ])(
    '$scenario $check: the async start raises the synchronous exception and records nothing',
    async ({ refusal, given, tableId, patches }) => {
      const table = await givenDraftOwnedTable(kit, ROW_COUNT);
      await given?.(table);
      const update = {
        revisionId: table.revisionId,
        tableId: tableId ?? table.tableId,
        patches,
      };

      const synchronous = await refusalOf(updateBelowTheThreshold(update));
      const asynchronous = await refusalOf(updateAboveTheThreshold(update));

      expect(synchronous.message).toMatch(refusal);
      expect(asynchronous).toEqual(synchronous);
      await expectMigrationAbsent(kit, update.revisionId, update.tableId);
    },
  );

  it('AM-33k accepts a foreign key to the table itself', async () => {
    const table = await givenDraftOwnedTable(kit, ROW_COUNT);

    const migration = await startAsyncUpdate(kit, table, 'relatedIds', [
      getAddPatch({
        path: '/properties/relatedIds',
        value: getArraySchema(getStringSchema({ foreignKey: table.tableId })),
      }),
    ]);

    await expect(
      kit.migrationApi.getMigrationStatus({
        revisionId: table.revisionId,
        tableId: table.tableId,
      }),
    ).resolves.toMatchObject({ migrationId: migration.migrationId });
  });

  let kit: MigrationTestKit;
  let synchronousKit: MigrationTestKit;

  beforeAll(async () => {
    kit = await createMigrationTestKit({
      threshold: THRESHOLD,
      workerMode: 'disabled',
    });
    synchronousKit = await createMigrationTestKit({
      threshold: Number.MAX_SAFE_INTEGER,
      workerMode: 'disabled',
    });
  });

  afterEach(async () => {
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await synchronousKit.close();
    await kit.close();
  });

  function updateBelowTheThreshold(update: TableUpdate): Promise<unknown> {
    return updateTableOnPath(synchronousKit, update, 'synchronous');
  }

  function updateAboveTheThreshold(update: TableUpdate): Promise<unknown> {
    return updateTableOnPath(kit, update, 'async');
  }

  async function storeSchemaTheMetaSchemaRejects(
    table: DraftOwnedTable,
  ): Promise<void> {
    await replaceDraftSchema(
      kit.prisma,
      table,
      getObjectSchema({
        ver: {
          ...getNumberSchema(),
          'x-formula': { version: 1, expression: '1' },
        },
      }),
    );
  }

  async function referenceTableMissingFromTheDraft(
    table: DraftOwnedTable,
  ): Promise<void> {
    await kit.draftApi.apiCreateTable({
      revisionId: table.revisionId,
      tableId: OWNERS_TABLE_ID,
      schema: getObjectSchema({ name: getStringSchema() }),
    });
    await synchronousKit.draftApi.apiUpdateTable({
      revisionId: table.revisionId,
      tableId: table.tableId,
      patches: [
        getAddPatch({
          path: '/properties/ownerIds',
          value: getArraySchema(
            getStringSchema({ foreignKey: OWNERS_TABLE_ID }),
          ),
        }),
      ],
    });
    await unlinkTable(kit.prisma, {
      revisionId: table.revisionId,
      tableId: OWNERS_TABLE_ID,
    });
  }

  async function storeViewsTheMigrationCannotRead(
    table: DraftOwnedTable,
  ): Promise<void> {
    await kit.module.get(ViewsApiService).updateTableViews({
      revisionId: table.revisionId,
      tableId: table.tableId,
      viewsData: productViews,
    });
    await replaceViewsData(kit.prisma, table, {
      ...productViews,
      views: [{ id: 'main', name: 'Main', columns: 'data.ver' }],
    } as unknown as InputJsonValue);
  }
});

async function updateTableOnPath(
  kit: MigrationTestKit,
  update: TableUpdate,
  path: 'synchronous' | 'async',
): Promise<unknown> {
  await expect(
    kit.migrationService.shouldUseAsyncMigrationByTableId(
      update.revisionId,
      update.tableId,
    ),
  ).resolves.toBe(path === 'async');

  return kit.draftApi.apiUpdateTable(update);
}

async function refusalOf(update: Promise<unknown>): Promise<Refusal> {
  const error = await update.then(
    () => undefined,
    (refusal: unknown) => refusal,
  );

  if (!(error instanceof Error)) {
    throw new Error('The table update was not refused');
  }

  return {
    type: error.constructor.name,
    message: error.message,
    response: error instanceof HttpException ? error.getResponse() : undefined,
  };
}
