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
  ) {}

  async plan(input: {
    branch: ChangesBranch;
    operation: ChangeOperation;
    selection: Selection;
  }): Promise<ChangePlan> {
    const limits = this.limits.values();
    const snapshot = await this.snapshotReader.read(input.branch, limits);
    const direction =
      input.operation === 'commit' ? COMMIT_DIRECTION : REVERT_DIRECTION;
    if (snapshot.oversized) {
      return refusedPlan(input.operation, direction, snapshot, [
        changedRowsBlocker(snapshot.changedRowCount, limits),
      ]);
    }

    const catalogue = buildChangeCatalogue(
      snapshot,
      this.viewsProjection.migrator,
    );
    const resolution = resolveSelection(catalogue, input.selection);

    const closure = await this.dependencyClosure.close({
      snapshot,
      catalogue,
      operation: input.operation,
      direction,
      selected: resolution.selected,
      required: resolution.required,
      excluded: resolution.excluded,
      preferOtherForUnitlessTables: Boolean(
        input.selection.all && !input.selection.exclude,
      ),
    });

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
    const estimate = await this.estimator.estimate(snapshot, closure.target);

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
        ...tooLargeBlockers(estimate, limits),
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
  blockers: Blocker[],
): ChangePlan {
  return {
    operation,
    snapshot,
    catalogue: emptyCatalogue(),
    direction,
    selected: new Set(),
    required: new Map(),
    applied: new Set(),
    blockers,
    unmatched: {},
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
    estimate: {
      changedRows: snapshot.changedRowCount,
      mergedRows: 0,
      mergedRowsWithFormulas: 0,
      mixedTables: [],
    },
  };
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
