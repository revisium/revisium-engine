import { Logger } from '@nestjs/common';
import { obj, str } from '@revisium/schema-toolkit/mocks';
import {
  createPartialChangesTestKit,
  type PartialChangesTestKit,
} from 'src/__tests__/kit/create-partial-changes-test-kit';
import {
  OPERATION_FINISHED,
  partialOperation,
  plannedFieldsOf,
} from 'src/features/partial-changes/logging/partial-operation-fields';
import type { FieldRef } from 'src/features/partial-changes/selection/selection';
import { ChangeType } from 'src/features/revision-changes/types';
import {
  OperationLog,
  type OperationLogEntry,
} from 'src/infrastructure/database/operation-log';
import { OperationTimeoutException } from 'src/infrastructure/database/operation-timeout.exception';
import { ChangesScenario } from '../../__tests__/support/changes-scenario';
import { commitWhileNativeWriteLands } from '../../__tests__/support/commit-races';
import { HeldPartialRevert } from '../../__tests__/support/revert-races';

const NOTES = 'notes';
const MAX_CHANGED_ROWS = 3;
const SECRET_TITLE = 'a secret title';

const noteSchema = obj({ title: str() });

const titleOf = (rowId: string): FieldRef => ({
  tableId: NOTES,
  rowId,
  path: '/title',
});

const PLANNED = {
  headRevisionId: 'head',
  draftRevisionId: 'draft',
  refusedTables: [],
};

describe('Partial operation log', () => {
  describe('an entry', () => {
    it('counts every attempt and the escalated ones', async () => {
      const entries = loggedEntries();

      await new OperationLog().track(
        partialOperation('commit', BRANCH),
        (trace) => {
          trace.attempted(false);
          trace.attempted(false);
          trace.attempted(true);
          trace.planned(plannedFieldsOf({ ...PLANNED, planned: true }));

          return Promise.resolve({ status: 'applied' });
        },
      );

      expect(entries.finished()).toEqual<OperationLogEntry[]>([
        {
          message: OPERATION_FINISHED,
          operation: 'commit',
          projectId: BRANCH.projectId,
          branchName: BRANCH.branchName,
          headRevisionId: 'head',
          draftRevisionId: 'draft',
          durationMs: expect.any(Number) as number,
          outcome: 'applied',
          attempts: 3,
          escalations: 1,
          tooLarge: false,
          refusedTables: 0,
        },
      ]);
    });

    it('keeps the facts of the last plan', async () => {
      const entries = loggedEntries();

      await new OperationLog().track(
        partialOperation('revert', BRANCH),
        (trace) => {
          trace.planned(
            plannedFieldsOf({ ...PLANNED, refusedTables: [unledgered('a')] }),
          );
          trace.planned(
            plannedFieldsOf({ ...PLANNED, draftRevisionId: 'next draft' }),
          );

          return Promise.resolve({ status: 'stale' });
        },
      );

      expect(entries.finished()).toMatchObject([
        { draftRevisionId: 'next draft', outcome: 'stale', refusedTables: 0 },
      ]);
    });

    it('forgets the plan of an earlier attempt when a later one fails before planning', async () => {
      const entries = loggedEntries();

      await expect(
        new OperationLog().track(
          partialOperation('commit', BRANCH),
          (trace) => {
            trace.attempted(false);
            trace.planned(plannedFieldsOf({ ...PLANNED, planned: false }));
            trace.attempted(false);

            return Promise.reject(new OperationTimeoutException(5));
          },
        ),
      ).rejects.toThrow(OperationTimeoutException);

      const [entry] = entries.failed();
      expect(entry).toMatchObject({ attempts: 2, outcome: 'error' });
      expect(entry).not.toHaveProperty('headRevisionId');
      expect(entry).not.toHaveProperty('tooLarge');
      expect(entry).not.toHaveProperty('refusedTables');
    });

    it('names the refused tables by their count and the first five ids', async () => {
      const entries = loggedEntries();
      const refused = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(unledgered);

      await new OperationLog().track(
        partialOperation('preview', BRANCH),
        (trace) => {
          trace.planned(
            plannedFieldsOf({ ...PLANNED, refusedTables: refused }),
          );

          return Promise.resolve({ status: 'blocked' });
        },
      );

      expect(entries.finished()).toMatchObject([
        { refusedTables: 7, refusedTableIds: ['a', 'b', 'c', 'd', 'e'] },
      ]);
    });

    it('carries the estimate of a plan a limit stopped, with its largest copy of row links', async () => {
      const entries = loggedEntries();

      await new OperationLog().track(
        partialOperation('preview', BRANCH),
        (trace) => {
          trace.planned(
            plannedFieldsOf({
              ...PLANNED,
              planned: false,
              estimate: {
                changedRows: 9,
                mergedRows: 2,
                perRowWorkRows: 1,
                mixedTables: [
                  { tableId: 'a', linksCopied: 10, linksAdded: 1 },
                  { tableId: 'b', linksCopied: 30, linksAdded: 0 },
                ],
              },
            }),
          );

          return Promise.resolve({ status: 'blocked' });
        },
      );

      expect(entries.finished()).toMatchObject([
        {
          tooLarge: true,
          estimate: {
            changedRows: 9,
            mergedRows: 2,
            perRowWorkRows: 1,
            mixedTables: 2,
            maxLinksCopied: 30,
          },
        },
      ]);
    });

    it('says `listed` for a result without a status, and nothing of limits a listing does not apply', async () => {
      const entries = loggedEntries();

      await new OperationLog().track(
        partialOperation('list', BRANCH),
        (trace) => {
          trace.attempted(false);
          trace.planned(plannedFieldsOf(PLANNED));

          return Promise.resolve({});
        },
      );

      const [entry] = entries.finished();
      expect(entry).toMatchObject({ outcome: 'listed', attempts: 1 });
      expect(entry).not.toHaveProperty('tooLarge');
      expect(entry).not.toHaveProperty('estimate');
    });
  });

  describe('partial operations', () => {
    it('log one entry for a listing page', async () => {
      const draft = await givenEditedNotes(['n1']);
      const entries = loggedEntries();

      await draft.listChanges();

      expect(entries.finished()).toEqual<OperationLogEntry[]>([
        {
          ...(await expectedEntryOf(draft, 'list')),
          outcome: 'listed',
          refusedTables: 0,
        },
      ]);
    });

    it('log one entry for a preview', async () => {
      const draft = await givenEditedNotes(['n1']);
      const entries = loggedEntries();

      await draft.previewChanges({
        operation: 'commit',
        selection: { fields: [titleOf('n1')] },
      });

      expect(entries.finished()).toEqual<OperationLogEntry[]>([
        {
          ...(await expectedEntryOf(draft, 'preview')),
          outcome: 'ready',
          tooLarge: false,
          refusedTables: 0,
        },
      ]);
    });

    it('log one entry for a commit, with the revisions it planned on and no row data', async () => {
      const draft = await givenEditedNotes(['n1']);
      const planned = await expectedEntryOf(draft, 'commit');
      const entries = loggedEntries();

      await draft.commitChanges({ selection: { fields: [titleOf('n1')] } });

      const finished = entries.finished();
      expect(finished).toEqual<OperationLogEntry[]>([
        { ...planned, outcome: 'applied', tooLarge: false, refusedTables: 0 },
      ]);
      expect(JSON.stringify(finished)).not.toContain(SECRET_TITLE);
    });

    it('log one entry for a revert', async () => {
      const draft = await givenEditedNotes(['n1']);
      const planned = await expectedEntryOf(draft, 'revert');
      const entries = loggedEntries();

      await draft.revertChanges({ selection: { fields: [titleOf('n1')] } });

      expect(entries.finished()).toEqual<OperationLogEntry[]>([
        { ...planned, outcome: 'applied', tooLarge: false, refusedTables: 0 },
      ]);
    });

    it('log every attempt of a commit that a native write made retry', async () => {
      const draft = await givenEditedNotes(['n1']);
      const entries = loggedEntries();

      const { attempts } = await commitWhileNativeWriteLands(
        kit,
        draft,
        { selection: { fields: [titleOf('n1')] } },
        () => draft.updateRow(NOTES, 'n1', { title: 'newer' }),
      );

      expect(attempts).toBe(2);
      expect(entries.finished()).toMatchObject([
        { operation: 'commit', outcome: 'applied', attempts, escalations: 0 },
      ]);
    });

    it('log the escalation of a revert that lost two attempts to native writes', async () => {
      const draft = await givenEditedNotes(['n1', 'n2']);
      const entries = loggedEntries();
      const revert = new HeldPartialRevert(kit, draft, {
        selection: { fields: [titleOf('n1')] },
      });

      await revert.losesAttemptTo(() =>
        draft.updateRow(NOTES, 'n1', { title: 'newer' }),
      );
      await revert.losesAttemptTo(() =>
        draft.updateRow(NOTES, 'n1', { title: 'newest' }),
      );

      await expect(revert.outcome()).resolves.toMatchObject({
        status: 'applied',
      });
      expect(entries.finished()).toMatchObject([
        {
          operation: 'revert',
          outcome: 'applied',
          attempts: 3,
          escalations: 1,
        },
      ]);
    });

    it('log the estimate of a preview the changed-rows limit stopped', async () => {
      const draft = await givenEditedNotes(['n1', 'n2', 'n3', 'n4']);
      const entries = loggedEntries();

      await draft.previewChanges({
        operation: 'commit',
        selection: { fields: [titleOf('n1')] },
      });

      expect(entries.finished()).toEqual<OperationLogEntry[]>([
        {
          ...(await expectedEntryOf(draft, 'preview')),
          outcome: 'blocked',
          tooLarge: true,
          estimate: {
            changedRows: MAX_CHANGED_ROWS + 1,
            mergedRows: 0,
            perRowWorkRows: 0,
            mixedTables: 0,
            maxLinksCopied: 0,
          },
          refusedTables: 0,
        },
      ]);
    });

    it('log the refused tables of a branch without a migration table', async () => {
      const draft = await ChangesScenario.committedWithoutLedger(kit, {
        [NOTES]: { schema: noteSchema, rows: { n1: { title: 'one' } } },
      });
      await draft.updateRow(NOTES, 'n1', { title: 'uno' });
      const entries = loggedEntries();

      await draft.commitChanges({ selection: { fields: [titleOf('n1')] } });

      expect(entries.finished()).toMatchObject([
        {
          operation: 'commit',
          outcome: 'blocked',
          refusedTables: 1,
          refusedTableIds: [NOTES],
        },
      ]);
    });

    it('log input the operation refuses as a failure before any attempt', async () => {
      const draft = await givenEditedNotes(['n1']);
      const entries = loggedEntries();

      await expect(
        draft.commitChanges({ selection: { tables: [NOTES] } as never }),
      ).rejects.toThrow();

      expect(entries.failed()).toEqual<OperationLogEntry[]>([
        {
          message: OPERATION_FINISHED,
          operation: 'commit',
          ...draft.branch,
          durationMs: expect.any(Number) as number,
          outcome: 'error',
          attempts: 0,
          escalations: 0,
          error: 'SelectionValidationError',
        },
      ]);
    });

    it('log a commit comment the operation refuses as a failure before any attempt', async () => {
      const draft = await givenEditedNotes(['n1']);
      const entries = loggedEntries();

      await expect(
        draft.commitChanges({
          selection: { fields: [titleOf('n1')] },
          comment: 42 as never,
        }),
      ).rejects.toThrow();

      expect(entries.failed()).toMatchObject([
        {
          operation: 'commit',
          outcome: 'error',
          attempts: 0,
          error: 'SelectionValidationError',
        },
      ]);
    });

    it('log a listing page and a preview whose input is refused', async () => {
      const draft = await givenEditedNotes(['n1']);
      const entries = loggedEntries();

      await expect(draft.listChanges({ pageSize: 0 })).rejects.toThrow();
      await expect(
        draft.previewChanges({
          operation: 'commit',
          selection: { tables: [NOTES] } as never,
        }),
      ).rejects.toThrow();

      expect(entries.failed()).toMatchObject([
        {
          operation: 'list',
          outcome: 'error',
          attempts: 0,
          error: 'ListingValidationError',
        },
        {
          operation: 'preview',
          outcome: 'error',
          attempts: 0,
          error: 'SelectionValidationError',
        },
      ]);
    });

    it('log one entry for a page of table changes, with the page size asked and returned and the filters given', async () => {
      const draft = await givenEditedNotes(['n1']);
      const entries = loggedEntries();

      await draft.readDraftTableChanges({
        first: 10,
        filters: { changeTypes: [ChangeType.Modified], search: null },
      });

      expect(entries.finished()).toEqual<OperationLogEntry[]>([
        {
          ...(await expectedEntryOf(draft, 'tableChanges')),
          outcome: 'read',
          pageSize: 10,
          returned: 1,
          filters: ['changeTypes'],
          refusedTables: 0,
        },
      ]);
    });

    it('log one entry for a page of row changes', async () => {
      const draft = await givenEditedNotes(['n1', 'n2']);
      const entries = loggedEntries();

      await draft.readDraftRowChanges({
        first: 1,
        filters: { tableId: NOTES, search: 'n' },
      });

      expect(entries.finished()).toEqual<OperationLogEntry[]>([
        {
          ...(await expectedEntryOf(draft, 'rowChanges')),
          outcome: 'read',
          pageSize: 1,
          returned: 1,
          filters: ['search', 'tableId'],
          refusedTables: 0,
        },
      ]);
    });

    it('log one entry for a summary', async () => {
      const draft = await givenEditedNotes(['n1']);
      const entries = loggedEntries();

      await draft.readDraftChangesSummary();

      expect(entries.finished()).toEqual<OperationLogEntry[]>([
        {
          ...(await expectedEntryOf(draft, 'summary')),
          outcome: 'read',
          filters: [],
          refusedTables: 0,
        },
      ]);
    });

    it('log the refused tables of a read', async () => {
      const draft = await ChangesScenario.committedWithoutLedger(kit, {
        [NOTES]: { schema: noteSchema, rows: { n1: { title: 'one' } } },
      });
      await draft.updateRow(NOTES, 'n1', { title: 'uno' });
      const entries = loggedEntries();

      await draft.readDraftTableChanges({ first: 10 });

      expect(entries.finished()).toMatchObject([
        {
          operation: 'tableChanges',
          refusedTables: 1,
          refusedTableIds: [NOTES],
        },
      ]);
    });

    it('log a read whose input is refused as a failure before any attempt', async () => {
      const draft = await givenEditedNotes(['n1']);
      const entries = loggedEntries();

      await expect(draft.readDraftRowChanges({ first: 0 })).rejects.toThrow();

      expect(entries.failed()).toEqual<OperationLogEntry[]>([
        {
          message: OPERATION_FINISHED,
          operation: 'rowChanges',
          ...draft.branch,
          durationMs: expect.any(Number) as number,
          outcome: 'error',
          attempts: 0,
          escalations: 0,
          error: 'ListingValidationError',
        },
      ]);
    });

    it('return a read when the logger throws', async () => {
      const draft = await givenEditedNotes(['n1']);
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {
        throw new Error('logger down');
      });

      await expect(draft.readDraftChangesSummary()).resolves.toMatchObject({
        rowsWithUnits: 1,
      });
    });

    let kit: PartialChangesTestKit;

    beforeAll(async () => {
      kit = await createPartialChangesTestKit({
        settings: {
          PARTIAL_CHANGES_MAX_CHANGED_ROWS: String(MAX_CHANGED_ROWS),
        },
      });
    });

    afterEach(async () => {
      await kit.guard.verifyAndForget();
    });

    afterAll(async () => {
      await kit.close();
    });

    async function givenEditedNotes(
      rowIds: readonly string[],
    ): Promise<ChangesScenario> {
      const rows = Object.fromEntries(
        rowIds.map((rowId) => [rowId, { title: 'one' }]),
      );
      const draft = await ChangesScenario.committed(kit, {
        [NOTES]: { schema: noteSchema, rows },
      });

      for (const rowId of rowIds) {
        await draft.updateRow(NOTES, rowId, { title: SECRET_TITLE });
      }

      return draft;
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});

const BRANCH = { projectId: 'project', branchName: 'master' };

function unledgered(tableId: string) {
  return { tableId, code: 'unledgeredTable' as const };
}

async function expectedEntryOf(
  draft: ChangesScenario,
  operation: OperationLogEntry['operation'],
) {
  return {
    message: OPERATION_FINISHED,
    operation,
    ...draft.branch,
    headRevisionId: await draft.revisionId('head'),
    draftRevisionId: await draft.revisionId('draft'),
    durationMs: expect.any(Number) as number,
    attempts: 1,
    escalations: 0,
  };
}

function loggedEntries() {
  const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

  return {
    finished: () => operationEntriesOf(log.mock.calls),
    failed: () => operationEntriesOf(warn.mock.calls),
  };
}

function operationEntriesOf(calls: unknown[][]): OperationLogEntry[] {
  return calls
    .map(([entry]) => entry)
    .filter(
      (entry): entry is OperationLogEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { message?: unknown }).message === OPERATION_FINISHED,
    );
}
