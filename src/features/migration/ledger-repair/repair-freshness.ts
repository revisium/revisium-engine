import { Injectable } from '@nestjs/common';
import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { ValidationFingerprint } from 'src/features/migration/queries/impl/plan-schema-ledger-repair.query';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';
import { DraftRowsValidation } from './draft-rows-validation';
import type { PlannedRepair } from './repair-planning';
import {
  type RepairBranch,
  type RepairState,
  RepairStateReader,
  type RevisionLedger,
} from './repair-state-reader';

@Injectable()
export class RepairFreshness {
  constructor(
    private readonly stateReader: RepairStateReader,
    private readonly draftRows: DraftRowsValidation,
  ) {}

  public async isFresh(
    branch: RepairBranch,
    { state, plan }: PlannedRepair,
  ): Promise<boolean> {
    if (!isSameState(state, await this.stateReader.readBranch(branch))) {
      return false;
    }

    return deepEqual(
      plan.fingerprint,
      await this.recomputedFingerprintOf(plan.fingerprint),
    );
  }

  private recomputedFingerprintOf({
    validatedTables,
    consultedTables,
  }: ValidationFingerprint): Promise<ValidationFingerprint> {
    return this.draftRows.fingerprintOf(
      validatedTables.map(({ tableVersionId }) => tableVersionId),
      consultedTables.map(({ tableVersionId }) => tableVersionId),
    );
  }
}

function isSameState(planned: RepairState, current: RepairState): boolean {
  return (
    planned.headRevisionId === current.headRevisionId &&
    planned.draftRevisionId === current.draftRevisionId &&
    deepEqual(contentOf(planned.head), contentOf(current.head)) &&
    deepEqual(contentOf(planned.draft), contentOf(current.draft))
  );
}

function contentOf({
  tableVersionIds,
  schemas,
  migrationRows,
}: RevisionLedger) {
  return {
    tableVersionIds: sortedEntriesOf(tableVersionIds),
    schemas: sortedEntriesOf(schemas),
    migrationRows: migrationRows
      .map(({ versionId, id, data, publishedAt }) => ({
        versionId,
        id,
        data,
        publishedAt: publishedAt.toISOString(),
      }))
      .sort((left, right) =>
        compareCodePoints(left.versionId, right.versionId),
      ),
  };
}

function sortedEntriesOf<T>(map: ReadonlyMap<string, T>): [string, T][] {
  return [...map].sort(([left], [right]) => compareCodePoints(left, right));
}
