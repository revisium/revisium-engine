import type { Row } from 'src/engine-prisma-types';
import {
  oppositeOf,
  type RevisionSide,
  type RowLinkChanges,
} from 'src/features/draft-revision/commands/impl/target-write-plan';
import { NO_LINK_CHANGES } from 'src/features/partial-changes/assembly/link-changes';
import type {
  OutcomeRules,
  TableOutcome,
} from 'src/features/partial-changes/assembly/outcome-rules';
import {
  type SystemTableTarget,
  systemTableOutcomeOf,
  systemTableTargetsOf,
} from 'src/features/partial-changes/assembly/system-table-targets';
import type { AssemblySource } from 'src/features/partial-changes/assembly/target-assembler';
import type { UnitKind } from 'src/features/partial-changes/catalogue/unit';
import type {
  SystemTableRows,
  SystemTableVersionIds,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { SystemTables } from 'src/features/share/system-tables.consts';

export interface SystemTablePlan extends RowLinkChanges {
  readonly tableId: SystemTables;
  readonly versionIds: SystemTableVersionIds;
  readonly outcome: TableOutcome;
  readonly linkSide: RevisionSide;
  readonly versionId?: string;
  readonly editInPlace: boolean;
  readonly relinkCandidate: boolean;
}

export function systemTablePlansOf(
  source: AssemblySource,
  rules: OutcomeRules,
): SystemTablePlan[] {
  return systemTableTargetsOf(source, rules).map((target) =>
    planOf(target, keepsNoUnitsOf(source, rules, target.ownerKinds)),
  );
}

function planOf(
  target: SystemTableTarget,
  relinkCandidate: boolean,
): SystemTablePlan {
  const { tableId, rows, linkSide, editInPlace } = target;
  const outcome = systemTableOutcomeOf(target);

  return {
    tableId,
    versionIds: versionIdsBySideOf(rows),
    outcome,
    linkSide,
    versionId: linkedVersionIdOf(rows, outcome, linkSide),
    editInPlace,
    ...systemLinkChangesOf(outcome, rows[linkSide], target.versions),
    relinkCandidate,
  };
}

function keepsNoUnitsOf(
  source: AssemblySource,
  rules: OutcomeRules,
  kinds: readonly UnitKind[],
): boolean {
  return source.catalogue.units
    .filter(({ unit }) => kinds.includes(unit.kind))
    .every(({ key }) => rules.isApplied(key));
}

function systemLinkChangesOf(
  outcome: TableOutcome,
  linked: readonly Row[],
  versions: readonly Row[],
): RowLinkChanges {
  if (outcome !== 'mixed') {
    return NO_LINK_CHANGES;
  }

  const linkedIds = versionIdsOf(linked);
  const desiredIds = versionIdsOf(versions);

  return {
    removedRowVersionIds: [...linkedIds].filter((id) => !desiredIds.has(id)),
    addedRowVersionIds: [...desiredIds].filter((id) => !linkedIds.has(id)),
    newRows: [],
  };
}

function linkedVersionIdOf(
  rows: SystemTableRows,
  outcome: TableOutcome,
  linkSide: RevisionSide,
): string | undefined {
  if (outcome === 'absent') {
    return undefined;
  }

  if (outcome === 'other') {
    return rows.versions[oppositeOf(linkSide)]?.versionId;
  }

  return rows.versions[linkSide]?.versionId;
}

function versionIdsBySideOf({
  versions,
}: SystemTableRows): SystemTableVersionIds {
  return {
    head: versions.head?.versionId,
    draft: versions.draft?.versionId,
  };
}

function versionIdsOf(rows: readonly Row[]): Set<string> {
  return new Set(rows.map(({ versionId }) => versionId));
}
