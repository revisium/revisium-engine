import { BadRequestException } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { DraftRevisionCommitCommand } from 'src/features/draft-revision/commands/impl/draft-revision-commit.command';
import { DraftRevisionCreateRowsCommand } from 'src/features/draft-revision/commands/impl/draft-revision-create-rows.command';
import { DraftRevisionCreateTableCommand } from 'src/features/draft-revision/commands/impl/draft-revision-create-table.command';
import { DraftRevisionUpdateRowsCommand } from 'src/features/draft-revision/commands/impl/draft-revision-update-rows.command';
import {
  DraftRevisionCommitCommandReturnType,
  DraftRevisionCreateRowsCommandReturnType,
  DraftRevisionUpdateRowsCommandReturnType,
} from 'src/features/draft-revision/commands/impl';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import {
  createDraftRevisionTestingModule,
  givenCommittedTableWithRows,
  prepareDraftRevisionTest,
} from './utils';

const COMMITTED_ROW_COUNT = 1_000;

describe('DraftRevisionCommitHandler', () => {
  let prismaService: PrismaService;
  let commandBus: CommandBus;
  let transactionService: TransactionPrismaService;

  beforeAll(async () => {
    const result = await createDraftRevisionTestingModule();
    prismaService = result.prismaService;
    commandBus = result.commandBus;
    transactionService = result.transactionService;
  });

  afterAll(async () => {
    await prismaService.$disconnect();
  });

  function runInTransaction(
    command: DraftRevisionCommitCommand,
  ): Promise<DraftRevisionCommitCommandReturnType> {
    return transactionService.run(() => commandBus.execute(command));
  }

  async function createChange(draftRevisionId: string, tableId: string) {
    return transactionService.run(() =>
      commandBus.execute(
        new DraftRevisionCreateTableCommand({
          revisionId: draftRevisionId,
          tableId,
        }),
      ),
    );
  }

  async function setHasChanges(revisionId: string, hasChanges: boolean) {
    await prismaService.revision.update({
      where: { id: revisionId },
      data: { hasChanges },
    });
  }

  describe('validation', () => {
    it('should throw if branch has no head revision', async () => {
      const { branchId } = await prepareDraftRevisionTest(prismaService);
      await prismaService.revision.updateMany({
        where: { branchId },
        data: { isHead: false },
      });

      const command = new DraftRevisionCommitCommand({ branchId });
      await expect(runInTransaction(command)).rejects.toThrow(
        BadRequestException,
      );
      await expect(runInTransaction(command)).rejects.toThrow(
        'Head revision not found',
      );
    });

    it('should throw if branch has no draft revision', async () => {
      const { branchId } = await prepareDraftRevisionTest(prismaService);
      await prismaService.revision.updateMany({
        where: { branchId },
        data: { isDraft: false },
      });

      const command = new DraftRevisionCommitCommand({ branchId });
      await expect(runInTransaction(command)).rejects.toThrow(
        BadRequestException,
      );
      await expect(runInTransaction(command)).rejects.toThrow(
        'Draft revision not found',
      );
    });

    it('should throw if draft has no changes', async () => {
      const { branchId } = await prepareDraftRevisionTest(prismaService);

      const command = new DraftRevisionCommitCommand({ branchId });
      await expect(runInTransaction(command)).rejects.toThrow(
        BadRequestException,
      );
      await expect(runInTransaction(command)).rejects.toThrow(
        'There are no changes',
      );
    });
  });

  describe('success cases', () => {
    it('should commit draft revision and create new draft', async () => {
      const { branchId, headRevisionId, draftRevisionId } =
        await prepareDraftRevisionTest(prismaService);
      await createChange(draftRevisionId, 'test-table');
      await setHasChanges(draftRevisionId, true);

      const command = new DraftRevisionCommitCommand({ branchId });
      const result = await runInTransaction(command);

      expect(result.previousHeadRevisionId).toBe(headRevisionId);
      expect(result.previousDraftRevisionId).toBe(draftRevisionId);
      expect(result.nextDraftRevisionId).toBeDefined();
      expect(result.nextDraftRevisionId).not.toBe(draftRevisionId);
    });

    it('should update revision flags correctly', async () => {
      const { branchId, headRevisionId, draftRevisionId } =
        await prepareDraftRevisionTest(prismaService);
      await createChange(draftRevisionId, 'test-table');
      await setHasChanges(draftRevisionId, true);

      const command = new DraftRevisionCommitCommand({ branchId });
      const result = await runInTransaction(command);

      const oldHead = await prismaService.revision.findUnique({
        where: { id: headRevisionId },
      });
      expect(oldHead?.isHead).toBe(false);
      expect(oldHead?.isDraft).toBe(false);

      const newHead = await prismaService.revision.findUnique({
        where: { id: draftRevisionId },
      });
      expect(newHead?.isHead).toBe(true);
      expect(newHead?.isDraft).toBe(false);
      expect(newHead?.hasChanges).toBe(false);

      const newDraft = await prismaService.revision.findUnique({
        where: { id: result.nextDraftRevisionId },
      });
      expect(newDraft?.isHead).toBe(false);
      expect(newDraft?.isDraft).toBe(true);
      expect(newDraft?.hasChanges).toBe(false);
      expect(newDraft?.parentId).toBe(draftRevisionId);
    });

    it('should lock tables and rows after commit', async () => {
      const { branchId, draftRevisionId } =
        await prepareDraftRevisionTest(prismaService);
      const tableResult = await createChange(draftRevisionId, 'test-table');
      await setHasChanges(draftRevisionId, true);

      const command = new DraftRevisionCommitCommand({ branchId });
      await runInTransaction(command);

      const table = await prismaService.table.findUnique({
        where: { versionId: tableResult.tableVersionId },
      });
      expect(table?.readonly).toBe(true);
    });

    it('should connect tables to new draft revision', async () => {
      const { branchId, draftRevisionId } =
        await prepareDraftRevisionTest(prismaService);
      const tableResult = await createChange(draftRevisionId, 'test-table');
      await setHasChanges(draftRevisionId, true);

      const command = new DraftRevisionCommitCommand({ branchId });
      const result = await runInTransaction(command);

      const newDraft = await prismaService.revision.findUnique({
        where: { id: result.nextDraftRevisionId },
        include: { tables: true },
      });
      expect(newDraft?.tables).toHaveLength(1);
      expect(newDraft?.tables[0]?.versionId).toBe(tableResult.tableVersionId);
    });

    it('should save comment when provided', async () => {
      const { branchId, draftRevisionId } =
        await prepareDraftRevisionTest(prismaService);
      await createChange(draftRevisionId, 'test-table');
      await setHasChanges(draftRevisionId, true);

      const comment = 'Added test table';
      const command = new DraftRevisionCommitCommand({ branchId, comment });
      await runInTransaction(command);

      const newHead = await prismaService.revision.findUnique({
        where: { id: draftRevisionId },
      });
      expect(newHead?.comment).toBe(comment);
    });

    it('should commit successfully when draft has no tables', async () => {
      const { branchId, draftRevisionId } =
        await prepareDraftRevisionTest(prismaService);
      await setHasChanges(draftRevisionId, true);

      const command = new DraftRevisionCommitCommand({ branchId });
      const result = await runInTransaction(command);

      expect(result.previousDraftRevisionId).toBe(draftRevisionId);
      expect(result.nextDraftRevisionId).toBeDefined();

      const newDraft = await prismaService.revision.findUnique({
        where: { id: result.nextDraftRevisionId },
        include: { tables: true },
      });
      expect(newDraft?.tables).toHaveLength(0);
    });
  });

  describe('readonly locking', () => {
    it('should lock exactly the row versions the draft owns without rewriting committed ones', async () => {
      const draft = await givenDraftChangingLargeCommittedTable();
      const writesBeforeCommit = await snapshotRowVersionWrites(draft.branchId);

      await runInTransaction(
        new DraftRevisionCommitCommand({ branchId: draft.branchId }),
      );

      const writesAfterCommit = await snapshotRowVersionWrites(draft.branchId);
      expect(
        findRewrittenRowVersionIds(writesBeforeCommit, writesAfterCommit),
      ).toEqual(draft.ownedRowVersionIds);
      expect(await findMutableRowVersionIds(draft.branchId)).toEqual([]);
    });
  });

  async function findMutableRowVersionIds(branchId: string): Promise<string[]> {
    const rows = await prismaService.row.findMany({
      where: {
        readonly: false,
        tables: { some: { revisions: { some: { branchId } } } },
      },
      select: { versionId: true },
    });

    return rows.map((row) => row.versionId);
  }

  async function snapshotRowVersionWrites(
    branchId: string,
  ): Promise<RowVersionWrites> {
    const rows = await prismaService.$queryRaw<
      { versionId: string; writingTransactionId: string }[]
    >`
      SELECT DISTINCT "Row"."versionId", "Row".xmin::text AS "writingTransactionId"
      FROM "Row"
      JOIN "_RowToTable" ON "_RowToTable"."A" = "Row"."versionId"
      JOIN "_RevisionToTable" ON "_RevisionToTable"."B" = "_RowToTable"."B"
      JOIN "Revision" ON "Revision"."id" = "_RevisionToTable"."A"
      WHERE "Revision"."branchId" = ${branchId}
    `;

    return new Map(
      rows.map((row) => [row.versionId, row.writingTransactionId]),
    );
  }

  function findRewrittenRowVersionIds(
    before: RowVersionWrites,
    after: RowVersionWrites,
  ): string[] {
    return [...before]
      .filter(
        ([versionId, writingTransactionId]) =>
          after.get(versionId) !== writingTransactionId,
      )
      .map(([versionId]) => versionId)
      .sort();
  }

  async function givenDraftChangingLargeCommittedTable(): Promise<DraftChangingLargeCommittedTable> {
    const { branchId, headRevisionId, draftRevisionId } =
      await prepareDraftRevisionTest(prismaService);
    await givenCommittedTableWithRows(prismaService, {
      headRevisionId,
      draftRevisionId,
      tableId: 'large-table',
      rowCount: COMMITTED_ROW_COUNT,
    });

    const updatedRowVersionIds = await updateRows(
      draftRevisionId,
      'large-table',
      ['row-1', 'row-2', 'row-3'],
    );
    const createdRowVersionIds = await createTableWithRows(
      draftRevisionId,
      'new-table',
      ['new-row-1', 'new-row-2'],
    );

    return {
      branchId,
      ownedRowVersionIds: [
        ...updatedRowVersionIds,
        ...createdRowVersionIds,
      ].sort(),
    };
  }

  async function updateRows(
    revisionId: string,
    tableId: string,
    rowIds: string[],
  ): Promise<string[]> {
    const result: DraftRevisionUpdateRowsCommandReturnType =
      await transactionService.run(() =>
        commandBus.execute(
          new DraftRevisionUpdateRowsCommand({
            revisionId,
            tableId,
            rows: rowIds.map((rowId) => ({ rowId, data: { changed: true } })),
          }),
        ),
      );

    return result.updatedRows.map((row) => row.rowVersionId);
  }

  async function createTableWithRows(
    revisionId: string,
    tableId: string,
    rowIds: string[],
  ): Promise<string[]> {
    await createChange(revisionId, tableId);
    const result: DraftRevisionCreateRowsCommandReturnType =
      await transactionService.run(() =>
        commandBus.execute(
          new DraftRevisionCreateRowsCommand({
            revisionId,
            tableId,
            rows: rowIds.map((rowId) => ({ rowId, data: {} })),
          }),
        ),
      );

    return result.createdRows.map((row) => row.rowVersionId);
  }
});

type RowVersionWrites = Map<string, string>;

interface DraftChangingLargeCommittedTable {
  branchId: string;
  ownedRowVersionIds: string[];
}
