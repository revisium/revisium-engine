import { Injectable } from '@nestjs/common';
import {
  COMMIT_DIRECTION,
  Direction,
  REVERT_DIRECTION,
  TargetState,
} from 'src/features/partial-changes-poc/assembly/target.types';
import { buildChangeCatalogue } from 'src/features/partial-changes-poc/catalogue/build-change-catalogue';
import { ChangeCatalogue } from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import { DependencyClosure } from 'src/features/partial-changes-poc/dependencies/dependency-closure.service';
import {
  Blocker,
  ChangeOperation,
  ChangesBranch,
  RequiredReason,
  Selection,
  SelectionItems,
} from 'src/features/partial-changes-poc/partial-changes.types';
import { computeFingerprint } from 'src/features/partial-changes-poc/planning/fingerprint';
import {
  LedgerPlan,
  planLedger,
} from 'src/features/partial-changes-poc/planning/ledger-plan';
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
  unmatched: SelectionItems;
  target: TargetState;
  ledger: LedgerPlan;
  fingerprint: string;
}

@Injectable()
export class ChangePlanner {
  constructor(
    private readonly snapshotReader: SnapshotReader,
    private readonly dependencyClosure: DependencyClosure,
    private readonly targetValidator: TargetValidator,
    private readonly viewsProjection: ViewsProjection,
  ) {}

  async plan(input: {
    branch: ChangesBranch;
    operation: ChangeOperation;
    selection: Selection;
  }): Promise<ChangePlan> {
    const snapshot = await this.snapshotReader.read(input.branch);
    const catalogue = buildChangeCatalogue(
      snapshot,
      this.viewsProjection.migrator,
    );
    const direction =
      input.operation === 'commit' ? COMMIT_DIRECTION : REVERT_DIRECTION;
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
      fingerprint: computeFingerprint(snapshot, catalogue, closure.applied),
    };
  }
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
