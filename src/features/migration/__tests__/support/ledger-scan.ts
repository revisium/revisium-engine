import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { JsonSchema, Migration } from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import { BranchApiService } from 'src/features/branch/branch-api.service';
import { MigrationApiService } from 'src/features/migration/migration-api.service';
import type {
  FindingContent,
  FindingRole,
  MismatchedRowHash,
  ScanSchemaLedgerData,
  SchemaLedgerFinding,
  SchemaLedgerScan,
} from 'src/features/migration/queries/impl/scan-schema-ledger.query';
import type { ChangesScenario } from 'src/features/partial-changes/__tests__/support/changes-scenario';
import type { RevisionSide } from 'src/features/partial-changes/__tests__/support/snapshot-reading';
import {
  type LedgerReplayInput,
  replayLedger,
} from 'src/features/share/ledger-replay/ledger-replay';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { TransactionPrismaClient } from 'src/features/share/types';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import { sql } from 'src/engine-prisma-types';

export type ScanOptions = Omit<
  ScanSchemaLedgerData,
  'projectId' | 'branchName'
>;

export type ExpectedFinding = FindingContent & { readonly tableId: string };

export interface ObservedReplays<T> {
  readonly result: T;
  readonly replays: readonly LedgerReplayInput[];
}

export interface TransactionMode {
  readonly readOnly: string;
  readonly isolation: string;
}

type InteractiveTransaction = (
  callback: (transaction: TransactionPrismaClient) => Promise<unknown>,
  options?: unknown,
) => Promise<unknown>;

export function scanLedgers(
  kit: PartialChangesTestKit,
  data: ScanSchemaLedgerData,
): Promise<SchemaLedgerScan> {
  return kit.module.get(MigrationApiService).scanSchemaLedger(data);
}

export function scanBranch(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
  options: ScanOptions = {},
): Promise<SchemaLedgerScan> {
  return scanLedgers(kit, { ...draft.branch, ...options });
}

export function scanProject(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
  options: ScanOptions = {},
): Promise<SchemaLedgerScan> {
  return scanLedgers(kit, { projectId: draft.branch.projectId, ...options });
}

export async function scanProjectPages(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
  limit: number,
): Promise<SchemaLedgerScan[]> {
  const pages = [await scanProject(kit, draft, { limit })];
  let cursor = pages[0]?.nextCursor;

  while (cursor) {
    const page = await scanProject(kit, draft, { limit, cursor });
    pages.push(page);
    cursor = page.nextCursor;
  }

  return pages;
}

export function findingsOf(
  scan: SchemaLedgerScan,
  tableId: string,
): SchemaLedgerFinding[] {
  return scan.findings.filter((finding) => finding.tableId === tableId);
}

export function findingOf(
  draft: ChangesScenario,
  role: FindingRole,
  revisionIds: readonly string[],
  expected: ExpectedFinding,
): SchemaLedgerFinding {
  return { ...draft.branch, ...expected, role, revisionIds };
}

export async function findingAt(
  draft: ChangesScenario,
  side: RevisionSide,
  expected: ExpectedFinding,
): Promise<SchemaLedgerFinding> {
  return findingOf(draft, side, [await draft.revisionId(side)], expected);
}

export function damagedTableRepairsOf(
  scan: SchemaLedgerScan,
): [string, string][] {
  return scan.findings.flatMap((finding) => {
    if (finding.code !== 'damagedTable') {
      return [];
    }

    return [[finding.tableId, finding.detail.repair]];
  });
}

export function sortedByHash(
  rowHashes: MismatchedRowHash[],
): MismatchedRowHash[] {
  return [...rowHashes].sort((left, right) =>
    compareCodePoints(left.hash, right.hash),
  );
}

export function hashOf(schema: JsonSchema): string {
  return objectHash(schema);
}

export async function schemaRowHashOf(
  draft: ChangesScenario,
  side: RevisionSide,
  tableId: string,
): Promise<string> {
  const row = await draft.row(side, SystemTables.Schema, tableId);

  return row.hash;
}

export async function rowSchemaHashOf(
  draft: ChangesScenario,
  tableId: string,
  rowId: string,
): Promise<string> {
  const row = await draft.row('draft', tableId, rowId);

  return row.schemaHash;
}

export async function userTableVersionCountOf(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
): Promise<number> {
  const [{ count }] = await kit.prisma.$queryRaw<[{ count: number }]>(sql`
    SELECT count(DISTINCT t."versionId")::int AS "count"
    FROM "Revision" r
    JOIN "_RevisionToTable" rt ON rt."A" = r."id"
    JOIN "Table" t ON t."versionId" = rt."B"
    WHERE r."branchId" = ${draft.branchId} AND NOT t."system"
  `);

  return count;
}

export async function committedRevisionIds(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
): Promise<string[]> {
  const revisions = await kit.prisma.revision.findMany({
    where: { branchId: draft.branchId, isDraft: false },
    orderBy: { sequence: 'asc' },
    select: { id: true },
  });

  return revisions.map(({ id }) => id);
}

export async function createBranchFromHead(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
  branchName: string,
): Promise<void> {
  await kit.module.get(BranchApiService).apiCreateBranchByRevisionId({
    revisionId: await draft.revisionId('head'),
    branchName,
  });
}

export async function pendingMigrationOf(
  draft: ChangesScenario,
  changeType: Migration['changeType'],
  tableId: string,
): Promise<Migration> {
  const { migrations } = (await draft.readSnapshot()).systemRows;
  const publishedIds = new Set(migrations.head.map(({ id }) => id));
  const migration = migrations.draft
    .filter(({ id }) => !publishedIds.has(id))
    .map(({ data }) => data as unknown as Migration)
    .find(
      (pending) =>
        pending.changeType === changeType && pending.tableId === tableId,
    );

  if (!migration) {
    throw new Error(`The Draft has no pending ${changeType} of ${tableId}`);
  }

  return migration;
}

export async function dropPendingMigration(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
  changeType: Migration['changeType'],
  tableId: string,
): Promise<void> {
  const migration = await pendingMigrationOf(draft, changeType, tableId);
  const revisionId = await draft.revisionId('draft');

  await kit.draftWriteAdmission.runSerializableRevisionWrite(revisionId, () =>
    kit.draftRevisionApi.removeRows({
      revisionId,
      tableId: SystemTables.Migration,
      rowIds: [migration.id],
    }),
  );
}

export async function transactionModesDuring(
  kit: PartialChangesTestKit,
  action: () => Promise<unknown>,
): Promise<TransactionMode[]> {
  const modes: TransactionMode[] = [];
  const prisma = kit.prisma as unknown as {
    $transaction: InteractiveTransaction;
  };
  const runTransaction = prisma.$transaction.bind(prisma);
  const spy = jest
    .spyOn(prisma, '$transaction')
    .mockImplementation((callback, options) =>
      runTransaction(async (transaction) => {
        const result = await callback(transaction);
        modes.push(await transactionModeOf(transaction));

        return result;
      }, options),
    );

  try {
    await action();
  } finally {
    spy.mockRestore();
  }

  return modes;
}

async function transactionModeOf(
  transaction: TransactionPrismaClient,
): Promise<TransactionMode> {
  const [mode] = await transaction.$queryRaw<TransactionMode[]>`
    SELECT current_setting('transaction_read_only') AS "readOnly",
           current_setting('transaction_isolation') AS "isolation"`;

  if (!mode) {
    throw new Error('The transaction reported no mode');
  }

  return mode;
}

export async function removeSchemaRow(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
  tableId: string,
): Promise<void> {
  const schemaTableVersionId = await draft.tableVersionId(
    'head',
    SystemTables.Schema,
  );
  const schemaRow = await draft.row('head', SystemTables.Schema, tableId);

  await kit.prisma.$executeRaw(sql`
    DELETE FROM "_RowToTable"
    WHERE "A" = ${schemaRow.versionId} AND "B" = ${schemaTableVersionId}
  `);
  await acceptDamagedCommittedVersions(kit, draft);
}

export async function removeSchemaTable(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
): Promise<void> {
  const schemaTableVersionId = await draft.tableVersionId(
    'head',
    SystemTables.Schema,
  );

  await kit.prisma.$executeRaw(sql`
    DELETE FROM "_RevisionToTable" WHERE "B" = ${schemaTableVersionId}
  `);
  await acceptDamagedCommittedVersions(kit, draft);
}

export async function storedHeadLedgerOf(
  draft: ChangesScenario,
): Promise<Migration[]> {
  const { migrations } = (await draft.readSnapshot()).systemRows;

  return migrations.head
    .map(({ data }) => data as unknown as Migration)
    .sort((left, right) => compareCodePoints(left.id, right.id));
}

export async function ledgerReplaysDuring<T>(
  action: () => Promise<T>,
): Promise<ObservedReplays<T>> {
  const replay = jest.mocked(replayLedger);
  replay.mockClear();

  const result = await action();

  return { result, replays: replay.mock.calls.map(([input]) => input) };
}

export function isStoredLedgerReplay(
  { ledger, schemas }: LedgerReplayInput,
  storedLedger: readonly Migration[],
): boolean {
  return schemas === undefined && deepEqual(ledger, storedLedger);
}

async function acceptDamagedCommittedVersions(
  kit: PartialChangesTestKit,
  draft: ChangesScenario,
): Promise<void> {
  kit.guard.forget();
  kit.guard.track(draft.branchId);
  await kit.guard.verify();
}
