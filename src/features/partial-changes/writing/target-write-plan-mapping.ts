import type {
  CommitTableWritePlan,
  CommitTargetWritePlan,
  RenumberedRows,
  RowLinkChanges,
  TableWritePlan,
  TargetTableVersion,
  TargetWritePlan,
} from 'src/features/draft-revision/commands/impl';
import type { RenumberedMigrationRow } from 'src/features/partial-changes/assembly/ledger-plan';
import type { SystemTablePlan } from 'src/features/partial-changes/assembly/system-target-assembler';
import type {
  AssembledTarget,
  TablePlan,
} from 'src/features/partial-changes/assembly/target-assembler';
import {
  type ChangesSnapshot,
  type TablePair,
  versionOn,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import { hasFileFields } from 'src/features/partial-changes/structure/schema-fields';
import { SystemTables } from 'src/features/share/system-tables.consts';

export interface WritableTarget {
  readonly source: {
    readonly snapshot: Pick<
      ChangesSnapshot,
      'branchId' | 'headRevisionId' | 'draftRevisionId' | 'tables'
    >;
  };
  readonly assembled: Pick<
    AssembledTarget,
    'tables' | 'systemTables' | 'ledger'
  >;
}

type SystemTableWriting = (plan: SystemTablePlan) => TableWritePlan;

export function targetWritePlanOf(writable: WritableTarget): TargetWritePlan {
  return writePlanOf(writable, systemTableWritePlanOf);
}

export function commitTargetWritePlanOf(
  writable: WritableTarget,
  comment?: string,
): CommitTargetWritePlan {
  const { renumbered } = writable.assembled.ledger;

  return {
    ...writePlanOf(writable, (plan) =>
      committedSystemTableWritePlanOf(plan, renumbered),
    ),
    branchId: writable.source.snapshot.branchId,
    comment,
  };
}

function writePlanOf(
  { source: { snapshot }, assembled }: WritableTarget,
  writeSystemTable: SystemTableWriting,
): TargetWritePlan {
  const pairs = new Map(snapshot.tables.map((pair) => [pair.identity, pair]));

  return {
    headRevisionId: snapshot.headRevisionId,
    draftRevisionId: snapshot.draftRevisionId,
    tables: [
      ...assembled.tables.map((plan) =>
        userTableWritePlanOf(plan, pairOf(pairs, plan.identity)),
      ),
      ...assembled.systemTables.map(writeSystemTable),
    ],
  };
}

function userTableWritePlanOf(
  plan: TablePlan,
  pair: TablePair,
): TableWritePlan {
  return {
    identity: plan.identity,
    headVersionId: pair.head?.versionId,
    draftVersionId: pair.draft?.versionId,
    target: userTableTargetOf(plan, pair),
    relinkCandidate: plan.relinkCandidate,
  };
}

function userTableTargetOf(
  plan: TablePlan,
  pair: TablePair,
): TargetTableVersion {
  if (plan.outcome !== 'mixed') {
    return { kind: 'linked', versionId: plan.versionId };
  }

  const structure = versionOn(pair, plan.structureSide);

  return {
    kind: 'mixed',
    tableId: structure.id,
    sourceVersionId: structure.versionId,
    editInPlace: plan.editInPlace,
    hasFileFields: hasFileFields(structure.schema),
    ...rowLinkChangesOf(plan),
  };
}

function systemTableWritePlanOf(plan: SystemTablePlan): TableWritePlan {
  return {
    identity: plan.tableId,
    headVersionId: plan.versionIds.head,
    draftVersionId: plan.versionIds.draft,
    target: systemTableTargetOf(plan),
    relinkCandidate: plan.relinkCandidate,
  };
}

function systemTableTargetOf(plan: SystemTablePlan): TargetTableVersion {
  if (plan.outcome !== 'mixed') {
    return { kind: 'linked', versionId: plan.versionId };
  }

  return {
    kind: 'mixed',
    tableId: plan.tableId,
    sourceVersionId: linkSideVersionIdOf(plan),
    editInPlace: plan.editInPlace,
    hasFileFields: false,
    ...rowLinkChangesOf(plan),
  };
}

function committedSystemTableWritePlanOf(
  plan: SystemTablePlan,
  renumbered: readonly RenumberedMigrationRow[],
): CommitTableWritePlan {
  const written = systemTableWritePlanOf(plan);

  if (plan.tableId !== SystemTables.Migration || renumbered.length === 0) {
    return written;
  }

  return { ...written, renumberedRows: renumberedRowsOf(renumbered) };
}

function renumberedRowsOf(
  renumbered: readonly RenumberedMigrationRow[],
): RenumberedRows {
  return {
    replacedRowVersionIds: renumbered.map(({ source }) => source.row.versionId),
    newRows: renumbered.map(({ row }) => row),
  };
}

function rowLinkChangesOf({
  removedRowVersionIds,
  addedRowVersionIds,
  newRows,
}: RowLinkChanges): RowLinkChanges {
  return { removedRowVersionIds, addedRowVersionIds, newRows };
}

function linkSideVersionIdOf({
  tableId,
  versionIds,
  linkSide,
}: SystemTablePlan): string {
  const versionId = versionIds[linkSide];

  if (versionId === undefined) {
    throw new Error(`System table ${tableId} has no ${linkSide} version`);
  }

  return versionId;
}

function pairOf(
  pairs: ReadonlyMap<string, TablePair>,
  identity: string,
): TablePair {
  const pair = pairs.get(identity);

  if (!pair) {
    throw new Error(`Table ${identity} is not in the planned snapshot`);
  }

  return pair;
}
