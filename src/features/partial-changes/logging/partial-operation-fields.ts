import type { RefusedTable } from 'src/features/partial-changes/head-schema/head-schema-check';
import type { PlanEstimate } from 'src/features/partial-changes/limits/operation-estimator';
import type { ChangeOperation } from 'src/features/partial-changes/plan/change-operation';
import type {
  LogFields,
  TrackedOperation,
} from 'src/infrastructure/database/operation-log';

export type DraftRead = 'tableChanges' | 'rowChanges' | 'summary';

type PartialOperation = 'list' | 'preview' | ChangeOperation | DraftRead;

export const OPERATION_FINISHED = 'Partial changes operation finished';

const LOGGED_REFUSED_TABLE_IDS = 5;

// What an operation learned from its plan, or from its listing page; only ids and counts, never row data.
interface PlannedFacts {
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly refusedTables: readonly RefusedTable[];
  // False when a limit stopped the plan; a listing page has no plan.
  readonly planned?: boolean;
  readonly estimate?: PlanEstimate;
}

interface LoggedEstimate {
  readonly changedRows: number;
  readonly mergedRows: number;
  readonly perRowWorkRows: number;
  readonly mixedTables: number;
  readonly maxLinksCopied: number;
}

// A listing page and a Draft read have no status.
export function partialOperation(
  operation: PartialOperation,
  branch: unknown,
): TrackedOperation {
  return {
    operation,
    message: OPERATION_FINISHED,
    branch,
    outcome: operation === 'list' ? 'listed' : 'read',
  };
}

// The fields of one attempt's plan, listing page or Draft read.
export function plannedFieldsOf(facts: PlannedFacts): LogFields {
  const { headRevisionId, draftRevisionId, refusedTables } = facts;

  return {
    headRevisionId,
    draftRevisionId,
    ...limitFieldsOf(facts),
    ...refusalFieldsOf(refusedTables),
  };
}

// A listing applies no limit, so it says nothing of one.
function limitFieldsOf({ planned, estimate }: PlannedFacts): LogFields {
  if (planned === undefined) {
    return {};
  }

  if (planned) {
    return { tooLarge: false };
  }

  if (!estimate) {
    return { tooLarge: true };
  }

  return { tooLarge: true, estimate: loggedEstimateOf(estimate) };
}

function refusalFieldsOf(refusedTables: readonly RefusedTable[]): LogFields {
  if (refusedTables.length === 0) {
    return { refusedTables: 0 };
  }

  return {
    refusedTables: refusedTables.length,
    refusedTableIds: refusedTables
      .slice(0, LOGGED_REFUSED_TABLE_IDS)
      .map(({ tableId }) => tableId),
  };
}

function loggedEstimateOf({
  changedRows,
  mergedRows,
  perRowWorkRows,
  mixedTables,
}: PlanEstimate): LoggedEstimate {
  return {
    changedRows,
    mergedRows,
    perRowWorkRows,
    mixedTables: mixedTables.length,
    // A loop, not an argument spread: a plan can hold more mixed tables than a call takes arguments.
    maxLinksCopied: mixedTables.reduce(
      (largest, { linksCopied }) => Math.max(largest, linksCopied),
      0,
    ),
  };
}
