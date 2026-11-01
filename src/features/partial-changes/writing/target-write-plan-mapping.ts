import type {
  CommitTableWritePlan,
  CommitTargetWritePlan,
  RenumberedRows,
  RowLinkChanges,
  TableWriteOutcome,
  TableWritePlan,
  TargetWritePlan,
} from 'src/features/draft-revision/commands/impl';
import type { RenumberedMigrationRow } from 'src/features/partial-changes/assembly/ledger-plan';
import type { LinkChanges } from 'src/features/partial-changes/assembly/link-changes';
import type { TableOutcome } from 'src/features/partial-changes/assembly/outcome-rules';
import type { SystemTablePlan } from 'src/features/partial-changes/assembly/system-target-assembler';
import type {
  AssembledTarget,
  TablePlan,
} from 'src/features/partial-changes/assembly/target-assembler';
import type {
  ChangesSnapshot,
  TablePair,
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
    outcome: writeOutcomeOf(plan.outcome),
    structureSide: plan.structureSide,
    ...rowLinkChangesOf(plan),
    relinkCandidate: plan.relinkCandidate,
    hasFileFields: structureHasFileFields(pair, plan),
  };
}

function systemTableWritePlanOf(plan: SystemTablePlan): TableWritePlan {
  return {
    identity: plan.tableId,
    headVersionId: plan.versionIds.head,
    draftVersionId: plan.versionIds.draft,
    outcome: writeOutcomeOf(plan.outcome),
    structureSide: plan.linkSide,
    ...rowLinkChangesOf(plan),
    relinkCandidate: plan.relinkCandidate,
    hasFileFields: false,
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

function writeOutcomeOf(outcome: TableOutcome): TableWriteOutcome {
  if (outcome === 'present') {
    return 'base';
  }

  return outcome;
}

function rowLinkChangesOf({
  removedLinks,
  addedLinks,
  newRows,
}: LinkChanges): RowLinkChanges {
  return {
    removedRowVersionIds: removedLinks,
    addedRowVersionIds: addedLinks,
    newRows,
  };
}

function structureHasFileFields(
  pair: TablePair,
  { structureSide }: TablePlan,
): boolean {
  const structure = pair[structureSide];

  if (!structure) {
    return false;
  }

  return hasFileFields(structure.schema);
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
