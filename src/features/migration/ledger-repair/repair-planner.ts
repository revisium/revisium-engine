import type {
  InvalidRows,
  PlannedTableRepair,
  RenumberedMigration,
} from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import type { TableAssessment } from './repair-ledger';

export interface PlannedRepairs {
  readonly tables: readonly PlannedTableRepair[];
  readonly renumbered: readonly RenumberedMigration[];
}

export function planDecidedRepairs(
  assessments: ReadonlyMap<string, TableAssessment>,
  invalidRows: ReadonlyMap<string, InvalidRows>,
): PlannedRepairs {
  const decided = [...assessments].flatMap(([tableId, assessment]) =>
    decidedOutcomesOf(tableId, assessment, invalidRows.get(tableId)),
  );

  return {
    tables: decided.sort((left, right) =>
      compareCodePoints(left.tableId, right.tableId),
    ),
    renumbered: [],
  };
}

function decidedOutcomesOf(
  tableId: string,
  assessment: TableAssessment,
  invalidRows: InvalidRows | undefined,
): PlannedTableRepair[] {
  if ('outcome' in assessment) {
    return [{ tableId, outcome: assessment.outcome }];
  }

  if (invalidRows) {
    return [{ tableId, outcome: 'rowsNeedMigration', invalidRows }];
  }

  if (assessment.baseline === 'replayedSchema') {
    return [{ tableId, outcome: 'alreadyRepaired' }];
  }

  return [];
}
