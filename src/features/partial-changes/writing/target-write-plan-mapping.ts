import type {
  RowLinkChanges,
  TableWriteOutcome,
  TableWritePlan,
  TargetWritePlan,
} from 'src/features/draft-revision/commands/impl';
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

export interface WritableTarget {
  readonly source: {
    readonly snapshot: Pick<
      ChangesSnapshot,
      'headRevisionId' | 'draftRevisionId' | 'tables'
    >;
  };
  readonly target: Pick<AssembledTarget, 'tables' | 'systemTables'>;
}

export function targetWritePlanOf({
  source: { snapshot },
  target,
}: WritableTarget): TargetWritePlan {
  const pairs = new Map(snapshot.tables.map((pair) => [pair.identity, pair]));

  return {
    headRevisionId: snapshot.headRevisionId,
    draftRevisionId: snapshot.draftRevisionId,
    tables: [
      ...target.tables.map((plan) =>
        userTableWritePlanOf(plan, pairOf(pairs, plan.identity)),
      ),
      ...target.systemTables.map(systemTableWritePlanOf),
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
