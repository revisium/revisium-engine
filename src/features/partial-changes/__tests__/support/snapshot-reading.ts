import type { PartialChangesTestKit } from 'src/__tests__/kit/create-partial-changes-test-kit';
import { TransactionIsolationLevel } from 'src/engine-prisma-types';
import {
  attributeLedger,
  type LedgerAttribution,
  pendingMigrationsOf,
} from 'src/features/partial-changes/catalogue/ledger-attribution';
import {
  checkHeadSchema,
  type HeadSchemaCheck,
} from 'src/features/partial-changes/head-schema/head-schema-check';
import type {
  ChangedRows,
  ChangesBranch,
  ChangesSnapshot,
  ComparedTable,
  RowPair,
  TablePair,
  TableVersion,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import {
  analyzeTableStructure,
  type TableSide,
} from 'src/features/partial-changes/structure/table-structure';

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

export type RevisionSide = 'head' | 'draft';

export interface ComparedSnapshot {
  readonly snapshot: ChangesSnapshot;
  readonly ledger: LedgerAttribution;
  readonly headSchema: HeadSchemaCheck;
  readonly tables: readonly ComparedTable[];
}

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

export async function readComparedSnapshot(
  kit: PartialChangesTestKit,
  branch: ChangesBranch,
  { wholeDraft }: OperationScope = PARTIAL_OPERATION,
): Promise<ComparedSnapshot> {
  const snapshot = await kit.snapshotReader.readSnapshot(branch);
  const ledger = attributeLedger(snapshot);
  const headSchema = checkHeadSchema(
    { snapshot, ledger, wholeDraft },
    kit.replayRules,
  );

  return {
    snapshot,
    ledger,
    headSchema,
    tables: comparedTablesOf(kit, snapshot, ledger, headSchema),
  };
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

function comparedTablesOf(
  kit: PartialChangesTestKit,
  snapshot: ChangesSnapshot,
  ledger: LedgerAttribution,
  headSchema: HeadSchemaCheck,
): ComparedTable[] {
  return snapshot.tables.flatMap(({ identity, head, draft }) => {
    if (!head || !draft) {
      return [];
    }

    const structure = analyzeTableStructure(
      {
        head: sideOf(snapshot, head, 'head'),
        draft: sideOf(snapshot, draft, 'draft'),
        pendingMigrations: pendingMigrationsOf(ledger, identity),
        replayedHeadSchema: headSchema.replayedHeadSchemas.get(identity),
      },
      kit.schemaRules,
    );

    return [
      {
        identity,
        headVersionId: head.versionId,
        draftVersionId: draft.versionId,
        structure,
      },
    ];
  });
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

function sideOf(
  snapshot: ChangesSnapshot,
  version: TableVersion,
  side: RevisionSide,
): TableSide {
  const tableIdentities = new Map<string, string>();

  for (const pair of snapshot.tables) {
    const sideVersion = pair[side];

    if (sideVersion) {
      tableIdentities.set(sideVersion.id, pair.identity);
    }
  }

  return {
    tableId: version.id,
    schema: version.schema,
    history: version.history,
    tableIdentities,
  };
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

function tableIdOf(snapshot: ChangesSnapshot, identity: string): string {
  const pair = snapshot.tables.find((table) => table.identity === identity);
  const tableId = pair?.draft?.id ?? pair?.head?.id;

  if (!tableId) {
    throw new Error(`Table identity ${identity} is in neither revision`);
  }

  return tableId;
}

function pairIdsOf({ head, draft }: RowPair): RowPairIds {
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
