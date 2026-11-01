import { expectMigrationAbsent } from 'src/__tests__/assertions/migration';
import {
  createMigrationTestKit,
  type MigrationTestKit,
} from 'src/__tests__/kit/create-migration-test-kit';
import type { InputJsonValue } from 'src/engine-prisma-types';
import {
  MigrationPhase,
  MigrationStatus,
} from 'src/features/migration/types/migration.types';
import { SystemTables } from 'src/features/share/system-tables.consts';
import {
  commitRevisionBehindMigration,
  describeDraftSchema,
  linkTableVersion,
  recordImportedLedgerId,
  removeOneRow,
  replaceDraftTableVersion,
  replacePayload,
  unlinkMigrationTable,
} from './support/migration-database';
import {
  afterSwapBegins,
  releaseStartedOwners,
  startOwnerUntil,
  type PausedOwner,
} from './support/migration-owners';
import {
  givenStartedFieldAddition,
  type StartedMigration,
} from './support/migration-scenario';
import { withoutLedgerAvailabilityRecheck } from './support/swap-faults';
import {
  expectNoRecordedUpdate,
  expectSchemaHistoryToEndWith,
  readLedger,
  readRevisionContents,
  readSchema,
  readSystemRow,
} from './support/revision-records';

const BATCH_SIZE = 5;
const ROW_COUNT = 3 * BATCH_SIZE;
const FIELD = 'price';
const IMPORTED_MIGRATION_ID = '2999-01-01T00:00:00.000Z';
const BEFORE_EVERY_PUBLISHED_MIGRATION = '2000-01-01T00:00:00.000Z';

interface SwapReady extends StartedMigration {
  owner: PausedOwner;
}

interface Recheck {
  scenario: string;
  code: string;
  change: string;
  apply: (migration: SwapReady) => Promise<void>;
}

describe('Async migration swap re-checks', () => {
  it.each<Recheck>([
    {
      scenario: 'AM-19',
      code: 'REVISION_NOT_DRAFT',
      change: 'the revision was committed',
      apply: (migration) =>
        commitRevisionBehindMigration(kit.prisma, migration.revisionId),
    },
    {
      scenario: 'AM-20',
      code: 'SOURCE_TABLE_REPLACED',
      change: 'the Draft links another version of the table',
      apply: async (migration) =>
        replaceDraftTableVersion(
          kit.prisma,
          migration.revisionId,
          (await readRecord(migration)).sourceTableVersionId,
        ),
    },
    {
      scenario: 'AM-20',
      code: 'SOURCE_TABLE_REPLACED',
      change: 'the Draft links the shadow table as well',
      apply: async (migration) =>
        linkTableVersion(
          kit.prisma,
          migration.revisionId,
          await shadowTableOf(migration),
        ),
    },
    {
      scenario: 'AM-21',
      code: 'SCHEMA_CHANGED',
      change: 'the Draft schema row changed',
      apply: (migration) =>
        describeDraftSchema(
          kit.prisma,
          migration.revisionId,
          migration.tableId,
        ),
    },
    {
      scenario: 'AM-21',
      code: 'SCHEMA_CHANGED',
      change: 'the patches no longer give the target schema',
      apply: (migration) =>
        replacePayload(kit.prisma, migration.migrationId, {
          version: 2,
          patches: [{ op: 'remove', path: '/properties/ver' }],
        } as unknown as InputJsonValue),
    },
    {
      scenario: 'AM-22',
      code: 'ROW_COUNT_MISMATCH',
      change: 'the shadow table lost a row',
      apply: async (migration) =>
        removeOneRow(kit.prisma, await shadowTableOf(migration)),
    },
    {
      scenario: 'AM-23',
      code: 'LEDGER_UNAVAILABLE',
      change: 'the Draft of an imported update lost its migration table',
      apply: (migration) => importIntoDraftWithoutLedger(migration),
    },
    {
      scenario: 'AM-24',
      code: 'LEDGER_ID_TAKEN',
      change: 'the imported id is already recorded in the Draft',
      apply: async (migration) =>
        recordImportedLedgerId(
          kit.prisma,
          migration.migrationId,
          await recordedInitIdOf(migration),
        ),
    },
    {
      scenario: 'AM-24',
      code: 'LEDGER_ID_TAKEN',
      change: 'the imported id is not after the last published migration',
      apply: (migration) =>
        recordImportedLedgerId(
          kit.prisma,
          migration.migrationId,
          BEFORE_EVERY_PUBLISHED_MIGRATION,
        ),
    },
  ])(
    '$scenario fails $code without retries and writes nothing when $change',
    async ({ code, apply }) => {
      const migration = await givenMigrationReadyToSwap();
      await apply(migration);
      const contents = await readRevisionContents(kit, migration.revisionId);

      await expect(migration.owner.resume()).resolves.toBe('failed');

      await expectFailedWith(migration, code);
      await expect(
        readRevisionContents(kit, migration.revisionId),
      ).resolves.toEqual(contents);
    },
  );

  describe('AM-25 recording the ledger row', () => {
    it('fails LEDGER_NOT_RECORDED instead of completing without the row when the availability re-check is removed', async () => {
      const migration = await givenMigrationReadyToSwap();
      await importIntoDraftWithoutLedger(migration);
      withoutLedgerAvailabilityRecheck(kit);
      const contents = await readRevisionContents(kit, migration.revisionId);

      await expect(migration.owner.resume()).resolves.toBe('failed');

      await expectFailedWith(migration, 'LEDGER_NOT_RECORDED');
      await expect(
        readRevisionContents(kit, migration.revisionId),
      ).resolves.toEqual(contents);
    });

    it('completes an interactive update without a ledger row in a Draft without a migration table, as the synchronous path does', async () => {
      const migration = await givenMigrationReadyToSwap();
      await unlinkMigrationTable(kit.prisma, migration.revisionId);

      await expect(migration.owner.resume()).resolves.toBe('completed');

      await expectMigrationAbsent(kit, migration.revisionId, migration.tableId);
      await expect(readSchema(kit, migration)).resolves.toHaveProperty(
        `properties.${FIELD}`,
      );
      await expectSchemaHistoryToEndWith(kit, migration, migration.patches);
      await expect(
        readSystemRow(kit, SystemTables.Migration, migration),
      ).resolves.toBeNull();
      await expectNoRecordedUpdate(kit, migration);
    });
  });

  let kit: MigrationTestKit;

  beforeAll(async () => {
    kit = await createMigrationTestKit({
      batchSize: BATCH_SIZE,
      workerMode: 'disabled',
    });
  });

  afterEach(async () => {
    await releaseStartedOwners();
    jest.restoreAllMocks();
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  async function givenMigrationReadyToSwap(): Promise<SwapReady> {
    const migration = await givenStartedFieldAddition(kit, {
      rowCount: ROW_COUNT,
      field: FIELD,
    });
    const owner = await startOwnerUntil(
      kit,
      migration.migrationId,
      afterSwapBegins(kit),
    );

    return { ...migration, owner };
  }

  async function importIntoDraftWithoutLedger(
    migration: StartedMigration,
  ): Promise<void> {
    await recordImportedLedgerId(
      kit.prisma,
      migration.migrationId,
      IMPORTED_MIGRATION_ID,
    );
    await unlinkMigrationTable(kit.prisma, migration.revisionId);
  }

  async function expectFailedWith(
    migration: StartedMigration,
    code: string,
  ): Promise<void> {
    await expect(readRecord(migration)).resolves.toMatchObject({
      status: MigrationStatus.FAILED,
      phase: MigrationPhase.SWAPPING,
      completedAt: expect.any(Date),
      errorMessage: expect.stringMatching(new RegExp(`^${code}: `)),
      retryCount: 0,
      lockedBy: null,
    });
  }

  function readRecord(migration: StartedMigration) {
    return kit.prisma.tableMigration.findUniqueOrThrow({
      where: { id: migration.migrationId },
    });
  }

  async function shadowTableOf(migration: StartedMigration): Promise<string> {
    const { shadowTableVersionId } = await readRecord(migration);

    if (!shadowTableVersionId) {
      throw new Error(`Migration ${migration.migrationId} has no shadow table`);
    }

    return shadowTableVersionId;
  }

  async function recordedInitIdOf(migration: StartedMigration) {
    const ledger = await readLedger(kit, migration.revisionId);
    const init = ledger.find(
      ({ changeType, tableId }) =>
        changeType === 'init' && tableId === migration.tableId,
    );

    if (!init) {
      throw new Error(
        `The Draft ledger records no init of ${migration.tableId}`,
      );
    }

    return init.id;
  }
});
