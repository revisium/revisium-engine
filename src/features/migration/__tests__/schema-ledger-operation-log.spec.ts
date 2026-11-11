import { Logger } from '@nestjs/common';
import { BranchScenario } from 'src/__tests__/fixtures/branch-scenario';
import {
  type BranchScenarioTestKit,
  createBranchScenarioTestKit,
} from 'src/__tests__/kit/create-branch-scenario-test-kit';
import { LEDGER_OPERATION_FINISHED } from 'src/features/migration/ledger-operation-log';
import type { OperationLogEntry } from 'src/infrastructure/database/operation-log';
import {
  backfillLedger,
  backfillWhileNativeWriteLands,
  revisionsOf,
} from './support/ledger-backfill';
import {
  CATEGORIES,
  categories,
  givenCommittedCatalog,
  givenUnpublishedInPlaceMigration,
  PRODUCTS,
  products,
} from './support/ledger-damage';
import { repairLedger } from './support/ledger-repair-writing';

describe('Schema ledger operation log', () => {
  let kit: BranchScenarioTestKit;

  beforeAll(async () => {
    kit = await createBranchScenarioTestKit();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await kit.guard.verifyAndForget();
  });

  afterAll(async () => {
    await kit.close();
  });

  describe('the backfill', () => {
    it('logs one entry for a dry run with the entries it planned', async () => {
      const draft = await givenCatalogWithoutLedger();
      const entries = loggedEntries();

      await backfillLedger(kit, draft, { dryRun: true });

      expect(entries.finished()).toEqual<OperationLogEntry[]>([
        {
          ...(await expectedEntryOf(draft, 'backfill')),
          dryRun: true,
          outcome: 'planned',
          entries: 2,
        },
      ]);
    });

    it('logs one entry for a run with the Head it replaced and the revisions it committed', async () => {
      const draft = await givenCatalogWithoutLedger();
      const before = await revisionsOf(draft);
      const entries = loggedEntries();

      await backfillLedger(kit, draft);

      expect(entries.finished()).toEqual<OperationLogEntry[]>([
        {
          ...branchEntryOf(draft, 'backfill'),
          previousHeadRevisionId: before.headRevisionId,
          headRevisionId: before.draftRevisionId,
          draftRevisionId: await draft.revisionId('draft'),
          dryRun: false,
          outcome: 'backfilled',
          entries: 2,
        },
      ]);
    });

    it('logs every attempt of a run that a native write made retry', async () => {
      const draft = await givenCatalogWithoutLedger();
      const entries = loggedEntries();

      await backfillWhileNativeWriteLands(kit, draft, () =>
        draft.updateRow(CATEGORIES, 'c1', { title: 'landed' }),
      );

      expect(entries.finished()).toMatchObject([
        { operation: 'backfill', outcome: 'backfilled', attempts: 2 },
      ]);
    });

    it('logs input it refuses as a failure before any attempt', async () => {
      const draft = await givenCatalogWithoutLedger();
      const entries = loggedEntries();

      await expect(
        backfillLedger(kit, draft, { dryRun: 'yes' }),
      ).rejects.toThrow();

      expect(entries.failed()).toEqual<OperationLogEntry[]>([
        {
          ...branchEntryOf(draft, 'backfill'),
          attempts: 0,
          outcome: 'error',
          error: 'BadRequestException',
        },
      ]);
    });

    it('returns its result when the logger throws', async () => {
      const draft = await givenCatalogWithoutLedger();
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {
        throw new Error('logger down');
      });

      await expect(backfillLedger(kit, draft)).resolves.toMatchObject({
        status: 'backfilled',
      });
    });
  });

  describe('the repair', () => {
    it('logs one entry for a dry run with the tables it would repair', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);
      const entries = loggedEntries();

      await repairLedger(kit, draft, { dryRun: true });

      expect(entries.finished()).toEqual<OperationLogEntry[]>([
        {
          ...(await expectedEntryOf(draft, 'repair')),
          dryRun: true,
          outcome: 'planned',
          tables: 1,
          repairedTables: 1,
          renumbered: 0,
        },
      ]);
    });

    it('logs one entry for a run that wrote, counting the planning and the write', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);
      const planned = await expectedEntryOf(draft, 'repair');
      const entries = loggedEntries();

      await repairLedger(kit, draft, { tableIds: [PRODUCTS] });

      expect(entries.finished()).toEqual<OperationLogEntry[]>([
        {
          ...planned,
          dryRun: false,
          outcome: 'repaired',
          attempts: 2,
          tables: 1,
          repairedTables: 1,
          renumbered: 0,
        },
      ]);
    });

    it('logs a run with nothing to repair as unchanged', async () => {
      const draft = await givenCommittedCatalog(kit);
      const entries = loggedEntries();

      await repairLedger(kit, draft);

      expect(entries.finished()).toMatchObject([
        {
          operation: 'repair',
          dryRun: false,
          outcome: 'unchanged',
          attempts: 1,
          tables: 0,
          repairedTables: 0,
        },
      ]);
    });

    it('logs input it refuses as a failure before any attempt', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);
      const entries = loggedEntries();

      await expect(
        repairLedger(kit, draft, { tableIds: PRODUCTS as never }),
      ).rejects.toThrow();

      expect(entries.failed()).toEqual<OperationLogEntry[]>([
        {
          ...branchEntryOf(draft, 'repair'),
          attempts: 0,
          outcome: 'error',
          error: 'BadRequestException',
        },
      ]);
    });

    it('returns its result when the logger throws', async () => {
      const draft = await givenUnpublishedInPlaceMigration(kit);
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {
        throw new Error('logger down');
      });

      const repair = await repairLedger(kit, draft);

      expect(repair.tables).toMatchObject([
        { tableId: PRODUCTS, outcome: 'repaired' },
      ]);
    });
  });

  function givenCatalogWithoutLedger(): Promise<BranchScenario> {
    return BranchScenario.committedWithoutLedger(kit, {
      [CATEGORIES]: categories,
      [PRODUCTS]: products,
    });
  }
});

function branchEntryOf(
  draft: BranchScenario,
  operation: OperationLogEntry['operation'],
) {
  return {
    message: LEDGER_OPERATION_FINISHED,
    operation,
    ...draft.branch,
    durationMs: expect.any(Number) as number,
    attempts: 1,
    escalations: 0,
  };
}

async function expectedEntryOf(
  draft: BranchScenario,
  operation: OperationLogEntry['operation'],
) {
  return {
    ...branchEntryOf(draft, operation),
    ...(await revisionsOf(draft)),
  };
}

function loggedEntries() {
  const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

  return {
    finished: () => ledgerEntriesOf(log.mock.calls),
    failed: () => ledgerEntriesOf(warn.mock.calls),
  };
}

function ledgerEntriesOf(calls: unknown[][]): OperationLogEntry[] {
  return calls
    .map(([entry]) => entry)
    .filter(
      (entry): entry is OperationLogEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { message?: unknown }).message === LEDGER_OPERATION_FINISHED,
    );
}
