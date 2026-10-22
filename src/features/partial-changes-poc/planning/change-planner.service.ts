import { Injectable } from '@nestjs/common';
import {
  COMMIT_DIRECTION,
  Direction,
  REVERT_DIRECTION,
  TargetState,
} from 'src/features/partial-changes-poc/assembly/target.types';
import { buildChangeCatalogue } from 'src/features/partial-changes-poc/catalogue/build-change-catalogue';
import {
  ChangeCatalogue,
  emptyCatalogue,
} from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import { DependencyClosure } from 'src/features/partial-changes-poc/dependencies/dependency-closure.service';
import {
  Blocker,
  ChangeOperation,
  ChangesBranch,
  OperationEstimate,
  RequiredReason,
  Selection,
  UnmatchedSelection,
} from 'src/features/partial-changes-poc/partial-changes.types';
import {
  computeFingerprint,
  tablesWithMutableDraftRows,
} from 'src/features/partial-changes-poc/planning/fingerprint';
import {
  LedgerPlan,
  planLedger,
} from 'src/features/partial-changes-poc/planning/ledger-plan';
import {
  changedRowsBlocker,
  OperationEstimator,
  tooLargeBlockers,
} from 'src/features/partial-changes-poc/planning/operation-estimator.service';
import { OperationLimits } from 'src/features/partial-changes-poc/planning/operation-limits.service';
import { ReadScope } from 'src/features/partial-changes-poc/planning/read-scope.service';
import { TargetValidator } from 'src/features/partial-changes-poc/planning/target-validator.service';
import { resolveSelection } from 'src/features/partial-changes-poc/selection/resolve-selection';
import { SnapshotReader } from 'src/features/partial-changes-poc/snapshot/snapshot-reader.service';
import { ChangesSnapshot } from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import { ViewsProjection } from 'src/features/partial-changes-poc/views/views-projection.service';

export interface ChangePlan {
  operation: ChangeOperation;
  snapshot: ChangesSnapshot;
  catalogue: ChangeCatalogue;
  direction: Direction;
  selected: Set<string>;
  required: Map<string, RequiredReason>;
  applied: Set<string>;
  blockers: Blocker[];
  unmatched: UnmatchedSelection;
  target: TargetState;
  ledger: LedgerPlan;
  fingerprint: string;
  estimate: OperationEstimate;
  refused: boolean;
}

@Injectable()
export class ChangePlanner {
  constructor(
    private readonly snapshotReader: SnapshotReader,
    private readonly dependencyClosure: DependencyClosure,
    private readonly targetValidator: TargetValidator,
    private readonly viewsProjection: ViewsProjection,
    private readonly limits: OperationLimits,
    private readonly estimator: OperationEstimator,
    private readonly readScope: ReadScope,
  ) {}

  async plan(input: {
    branch: ChangesBranch;
    operation: ChangeOperation;
    selection: Selection;
  }): Promise<ChangePlan> {
    const limits = this.limits.values();
    const snapshot = await this.snapshotReader.read(input.branch, {
      scope: this.readScope.forSelection(input.selection),
      readAll: limits.readScope === 'all',
      maxChangedRows: limits.maxChangedRows,
    });
    const direction =
      input.operation === 'commit' ? COMMIT_DIRECTION : REVERT_DIRECTION;
    if (snapshot.oversized) {
      return refusedPlan(input.operation, direction, snapshot, {
        blockers: [changedRowsBlocker(snapshot.changedRowCount, limits)],
      });
    }

    const catalogue = buildChangeCatalogue(
      snapshot,
      this.viewsProjection.migrator,
    );
    const resolution = resolveSelection(catalogue, input.selection);
    const outcomeInput = {
      catalogue,
      operation: input.operation,
      direction,
      preferOtherForUnitlessTables: Boolean(
        input.selection.all && !input.selection.exclude,
      ),
    };
    const linkCounts = new Map<string, number>();
    let estimate = emptyEstimate(snapshot.changedRowCount);

    const closure = await this.dependencyClosure.close({
      ...outcomeInput,
      snapshot,
      selected: resolution.selected,
      required: resolution.required,
      excluded: resolution.excluded,
      admit: async (applied) => {
        estimate = await this.estimator.estimate({
          ...outcomeInput,
          applied,
          changedRows: snapshot.changedRowCount,
          linkCounts,
        });
        return tooLargeBlockers(estimate, limits);
      },
    });
    if (closure.kind === 'refused') {
      return refusedPlan(input.operation, direction, snapshot, {
        catalogue,
        selected: resolution.selected,
        required: closure.required,
        applied: closure.applied,
        unmatched: resolution.unmatched,
        blockers: closure.blockers,
        estimate,
      });
    }

    const ledger = planLedger({
      catalogue,
      operation: input.operation,
      applied: closure.applied,
    });
    const validationBlockers = await this.targetValidator.findBlockers({
      snapshot,
      catalogue,
      target: closure.target,
      applied: closure.applied,
      ledger,
    });
    return {
      operation: input.operation,
      snapshot,
      catalogue,
      direction,
      selected: resolution.selected,
      required: closure.required,
      applied: closure.applied,
      blockers: uniqueBlockers([
        ...resolution.blockers,
        ...closure.blockers,
        ...validationBlockers,
      ]),
      unmatched: resolution.unmatched,
      target: closure.target,
      ledger,
      fingerprint: computeFingerprint({
        operation: input.operation,
        snapshot,
        catalogue,
        applied: closure.applied,
        draftRowDigests: await this.draftRowDigests(catalogue, closure.applied),
      }),
      estimate,
      refused: false,
    };
  }

  private async draftRowDigests(
    catalogue: ChangeCatalogue,
    applied: ReadonlySet<string>,
  ): Promise<Map<string, string>> {
    const digests = new Map<string, string>();
    for (const table of tablesWithMutableDraftRows(catalogue, applied)) {
      digests.set(
        table.tableCreatedId,
        await this.snapshotReader.readRowsDigest(table.draftVersionId),
      );
    }
    return digests;
  }
}

function refusedPlan(
  operation: ChangeOperation,
  direction: Direction,
  snapshot: ChangesSnapshot,
  refusal: Partial<
    Pick<
      ChangePlan,
      | 'catalogue'
      | 'selected'
      | 'required'
      | 'applied'
      | 'unmatched'
      | 'estimate'
    >
  > & { blockers: Blocker[] },
): ChangePlan {
  return {
    operation,
    snapshot,
    catalogue: refusal.catalogue ?? emptyCatalogue(),
    direction,
    selected: refusal.selected ?? new Set(),
    required: refusal.required ?? new Map(),
    applied: refusal.applied ?? new Set(),
    blockers: refusal.blockers,
    unmatched: refusal.unmatched ?? {},
    target: {
      operation,
      direction,
      tables: [],
      views: [],
      blockers: [],
      deferred: [],
    },
    ledger: { target: [], remaining: [], renumbered: [] },
    fingerprint: '',
    estimate: refusal.estimate ?? emptyEstimate(snapshot.changedRowCount),
    refused: true,
  };
}

function emptyEstimate(changedRows: number): OperationEstimate {
  return { changedRows, mergedRows: 0, perRowWorkRows: 0, mixedTables: [] };
}

function uniqueBlockers(blockers: Blocker[]): Blocker[] {
  const seen = new Set<string>();
  return blockers.filter((blocker) => {
    const key = `${blocker.code}|${blocker.tableId ?? ''}|${blocker.rowId ?? ''}|${blocker.path ?? ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
