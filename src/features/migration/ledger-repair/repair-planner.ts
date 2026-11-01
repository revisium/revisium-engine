import type {
  InvalidRows,
  PlannedTableRepair,
  RenumberedMigration,
} from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import type { SchemaRefs } from 'src/features/share/ledger-replay/native-schema-rules';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import {
  type RepairCandidate,
  verifyCombinedPlan,
  type VerifiedPlan,
} from './combined-verification';
import type { RepairLedger, TableAssessment } from './repair-ledger';
import { type HistoryPatchesValidator, repairPatchOf } from './repair-patch';

export interface PlannedRepairs {
  readonly tables: readonly PlannedTableRepair[];
  readonly renumbered: readonly RenumberedMigration[];
}

type PreliminaryOutcome =
  | { readonly decided: PlannedTableRepair }
  | { readonly candidate: RepairCandidate };

export class RepairPlanner {
  constructor(
    private readonly ledger: RepairLedger,
    private readonly historyValidator: HistoryPatchesValidator,
    private readonly refs: SchemaRefs,
  ) {}

  public plan(
    assessments: ReadonlyMap<string, TableAssessment>,
    invalidRows: ReadonlyMap<string, InvalidRows>,
  ): PlannedRepairs {
    const decided: PlannedTableRepair[] = [];
    const candidates = new Map<string, RepairCandidate>();

    for (const [tableId, assessment] of assessments) {
      const preliminary = this.preliminaryOutcomeOf(
        tableId,
        assessment,
        invalidRows.get(tableId),
      );

      if ('candidate' in preliminary) {
        candidates.set(tableId, preliminary.candidate);
      } else {
        decided.push(preliminary.decided);
      }
    }

    const verified = verifyCombinedPlan(this.ledger, candidates);

    return {
      tables: [...decided, ...verifiedTablesOf(candidates, verified)].sort(
        (left, right) => compareCodePoints(left.tableId, right.tableId),
      ),
      renumbered: verified.renumbered,
    };
  }

  private preliminaryOutcomeOf(
    tableId: string,
    assessment: TableAssessment,
    invalidRows: InvalidRows | undefined,
  ): PreliminaryOutcome {
    if ('outcome' in assessment) {
      return { decided: { tableId, outcome: assessment.outcome } };
    }

    if (invalidRows) {
      return {
        decided: { tableId, outcome: 'rowsNeedMigration', invalidRows },
      };
    }

    if (assessment.baseline === 'replayedSchema') {
      return { decided: { tableId, outcome: 'alreadyRepaired' } };
    }

    const patch = repairPatchOf(
      this.ledger,
      tableId,
      this.historyValidator,
      this.refs,
    );

    if (!patch) {
      return { decided: { tableId, outcome: 'patchNotReproducible' } };
    }

    return { candidate: { draftTableId: assessment.draftTableId, patch } };
  }
}

function verifiedTablesOf(
  candidates: ReadonlyMap<string, RepairCandidate>,
  { repairIds, rejections }: VerifiedPlan,
): PlannedTableRepair[] {
  return [...candidates].map(([tableId, { patch }]) => {
    const rejection = rejections.get(tableId);

    if (rejection) {
      return { tableId, ...rejection };
    }

    return {
      tableId,
      outcome: 'repaired',
      migrationId: repairIds.get(tableId),
      patches: patch.patches,
      removedPaths: patch.removedPaths,
    };
  });
}
