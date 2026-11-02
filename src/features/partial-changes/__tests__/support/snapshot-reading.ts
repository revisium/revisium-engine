import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import { TransactionIsolationLevel } from 'src/engine-prisma-types';
import type {
  ChangedRows,
  ChangesBranch,
  ChangesSnapshot,
  ComparedTable,
  RowPair,
  TablePair,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { ComparedSnapshot } from 'src/features/partial-changes/snapshot/compared-snapshot-reader.service';

export interface RowPairIds {
  readonly head?: string;
  readonly draft?: string;
}

export interface ChangedRowsView {
  readonly count: number;
  readonly readTableIds: readonly string[];
  pairsOf(tableId: string): RowPairIds[];
  rowPairOf(tableId: string, rowId: string): RowPair | undefined;
}

export type { RevisionSide } from 'src/features/draft-revision/commands/impl/target-write-plan';

export interface OperationScope {
  readonly wholeDraft: boolean;
}

const PARTIAL_OPERATION: OperationScope = { wholeDraft: false };

export function readInPlanningTransaction<T>(
  kit: PartialChangesTestKit,
  read: () => Promise<T>,
): Promise<T> {
  return kit.transactionService.run(
    async () => {
      await kit.transactionService.getTransaction()
        .$executeRaw`SET TRANSACTION READ ONLY`;

      return read();
    },
    { isolationLevel: TransactionIsolationLevel.RepeatableRead },
  );
}

export function readChangedRows(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  tableIds: readonly string[],
): Promise<ChangedRowsView> {
  return readInPlanningTransaction(kit, async () => {
    const { snapshot, tables } = await readComparedSnapshot(kit, branch);
    const affected = affectedTablesOf(snapshot, tables, tableIds);
    const count = await kit.snapshotReader.countChangedRows(affected);
    const changedRows = await kit.snapshotReader.readChangedRows(affected);

    return changedRowsView(snapshot, count, changedRows);
  });
}

export function readComparedSnapshot(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  scope: OperationScope = PARTIAL_OPERATION,
): Promise<ComparedSnapshot> {
  return kit.comparedSnapshotReader.readComparedSnapshot(branch, scope);
}

export function affectedTablesOf(
  snapshot: ChangesSnapshot,
  tables: readonly ComparedTable[],
  tableIds: readonly string[],
): ComparedTable[] {
  const identities = new Set(
    tableIds.flatMap((tableId) =>
      pairsNamed(snapshot, tableId).map(({ identity }) => identity),
    ),
  );

  return tables.filter(({ identity }) => identities.has(identity));
}

function pairsNamed(snapshot: ChangesSnapshot, tableId: string): TablePair[] {
  const pairs = snapshot.tables.filter(
    ({ head, draft }) => draft?.id === tableId || head?.id === tableId,
  );

  if (pairs.length === 0) {
    throw new Error(`Table ${tableId} is in neither revision`);
  }

  return pairs;
}

function changedRowsView(
  snapshot: ChangesSnapshot,
  count: number,
  changedRows: ChangedRows,
): ChangedRowsView {
  const pairsByTableId = new Map<string, readonly RowPair[]>();

  for (const [identity, pairs] of changedRows) {
    pairsByTableId.set(tableIdOf(snapshot, identity), pairs);
  }

  return {
    count,
    readTableIds: [...pairsByTableId.keys()].sort(byText),
    pairsOf: (tableId) =>
      (pairsByTableId.get(tableId) ?? [])
        .map(pairIdsOf)
        .sort((left, right) => byText(pairKey(left), pairKey(right))),
    rowPairOf: (tableId, rowId) =>
      pairsByTableId
        .get(tableId)
        ?.find(({ head, draft }) => (draft ?? head)?.id === rowId),
  };
}

export function tableIdOf(snapshot: ChangesSnapshot, identity: string): string {
  const pair = snapshot.tables.find((table) => table.identity === identity);
  const tableId = pair?.draft?.id ?? pair?.head?.id;

  if (!tableId) {
    throw new Error(`Table identity ${identity} is in neither revision`);
  }

  return tableId;
}

export function pairIdsOf({ head, draft }: RowPair): RowPairIds {
  if (!head) {
    return { draft: draft?.id };
  }

  if (!draft) {
    return { head: head.id };
  }

  return { head: head.id, draft: draft.id };
}

function pairKey({ head, draft }: RowPairIds): string {
  return `${draft ?? head}/${head ?? ''}`;
}

function byText(left: string, right: string): number {
  return left.localeCompare(right);
}
