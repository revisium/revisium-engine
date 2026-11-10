import { obj, str } from '@revisium/schema-toolkit/mocks';
import type { ProviderOverride } from 'src/__tests__/kit/create-database-service-test-kit';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import { MigrationApiService } from 'src/features/migration/migration-api.service';
import { MIGRATION_OPTIONS } from 'src/features/migration/migration.consts';
import type { MigrationOptions } from 'src/features/migration/types/migration-options.types';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import { addField } from 'src/__tests__/fixtures/ledger-steps';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';

const ONE_HOUR_MS = 3_600_000;

const ASYNC_MIGRATIONS_LEFT_ACTIVE: ProviderOverride = {
  provide: MIGRATION_OPTIONS,
  useValue: {
    threshold: 1,
    workerMode: 'disabled',
    pollIntervalMs: ONE_HOUR_MS,
  } satisfies MigrationOptions,
};

const CATEGORIES = 'categories';
const PRODUCTS = 'products';
const OPERATIONS: ChangeOperation[] = ['commit', 'revert'];

const titleSchema = obj({ title: str() });

const titleOfP1: Selection = {
  fields: [{ tableId: PRODUCTS, rowId: 'p1', path: '/title' }],
};

describe('previewChanges during an async migration', () => {
  let kit: PartialChangesTestKit;
  const migratingDrafts = new Set<ChangesScenario>();

  beforeAll(async () => {
    kit = await createPartialChangesTestKit({
      overrides: [ASYNC_MIGRATIONS_LEFT_ACTIVE],
    });
  });

  afterEach(async () => {
    for (const draft of migratingDrafts) {
      await abortMigrationOf(draft, CATEGORIES);
    }

    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  it.each(OPERATIONS)(
    'reports an active async migration on the branch as the blocker migrationInProgress of a %s',
    async (operation) => {
      const draft = await givenTitleEditNextToMigratingCategories();

      const preview = await draft.previewChanges({
        operation,
        selection: titleOfP1,
      });

      expect(preview).toMatchObject({
        status: 'blocked',
        blockers: [
          {
            code: 'migrationInProgress',
            tableId: CATEGORIES,
            message:
              'An async migration of categories is active on the branch; wait for it to end',
          },
        ],
        required: [],
        counts: { selected: 1, required: 0 },
      });
    },
  );

  it('plans without the blocker once the migration was aborted', async () => {
    const draft = await givenTitleEditNextToMigratingCategories();
    await abortMigrationOf(draft, CATEGORIES);

    const preview = await draft.previewChanges({
      operation: 'commit',
      selection: titleOfP1,
    });

    expect(preview).toMatchObject({ status: 'ready', blockers: [] });
  });

  async function givenTitleEditNextToMigratingCategories(): Promise<ChangesScenario> {
    const draft = await givenTitleEditsNextToMigratingCategories(kit, ['p1']);
    migratingDrafts.add(draft);

    return draft;
  }

  async function abortMigrationOf(
    draft: ChangesScenario,
    tableId: string,
  ): Promise<void> {
    await abortMigration(kit, draft, tableId);
    migratingDrafts.delete(draft);
  }
});

describe('previewChanges stopped by a limit during an async migration', () => {
  let kit: PartialChangesTestKit;
  let draft: ChangesScenario | undefined;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit({
      settings: { PARTIAL_CHANGES_MAX_CHANGED_ROWS: '1' },
      overrides: [ASYNC_MIGRATIONS_LEFT_ACTIVE],
    });
  });

  afterEach(async () => {
    if (draft) {
      await abortMigration(kit, draft, CATEGORIES);
      draft = undefined;
    }

    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  it.each(OPERATIONS)(
    'returns with the tooLarge blocker of a stopped %s the blocker migrationInProgress (AS-87)',
    async (operation) => {
      draft = await givenTitleEditsNextToMigratingCategories(kit, ['p1', 'p2']);

      const preview = await draft.previewChanges({
        operation,
        selection: titleOfP1,
      });

      expect(preview).toMatchObject({
        status: 'blocked',
        planned: false,
        fingerprint: null,
        counts: null,
        blockers: [
          { code: 'migrationInProgress', tableId: CATEGORIES },
          { code: 'tooLarge' },
        ],
      });
    },
  );
});

async function givenTitleEditsNextToMigratingCategories(
  kit: PartialChangesTestKit,
  productIds: readonly string[],
): Promise<ChangesScenario> {
  const draft = await ChangesScenario.committed(kit, {
    [CATEGORIES]: { schema: titleSchema, rows: { c1: { title: 'one' } } },
    [PRODUCTS]: {
      schema: titleSchema,
      rows: Object.fromEntries(
        productIds.map((rowId) => [rowId, { title: 'one' }]),
      ),
    },
  });

  for (const rowId of productIds) {
    await draft.updateRow(PRODUCTS, rowId, { title: 'edited' });
  }

  await draft.updateTable(CATEGORIES, [addField('color', str())]);

  return draft;
}

async function abortMigration(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
  tableId: string,
): Promise<void> {
  await kit.module.get(MigrationApiService).abortMigration({
    revisionId: await draft.revisionId('draft'),
    tableId,
  });
}
