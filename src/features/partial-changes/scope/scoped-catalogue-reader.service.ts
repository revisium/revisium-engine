import { Injectable } from '@nestjs/common';
import {
  buildChangeCatalogue,
  type ChangeCatalogue,
} from 'src/features/partial-changes/catalogue/change-catalogue';
import { PartialChangesLimits } from 'src/features/partial-changes/limits/partial-changes-limits';
import { changedRowsTooLarge } from 'src/features/partial-changes/limits/too-large-blockers';
import type { PlainBlocker } from 'src/features/partial-changes/plan/plan-blocker';
import {
  ReadScope,
  type TableScope,
} from 'src/features/partial-changes/scope/read-scope';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';
import type { ComparedSnapshot } from 'src/features/partial-changes/snapshot/compared-snapshot-reader.service';

interface ScopeCounts {
  readonly changedRowCount: number;
}

export type ScopedCatalogue =
  | (ScopeCounts & {
      readonly kind: 'catalogue';
      readonly catalogue: ChangeCatalogue;
    })
  | (ScopeCounts & {
      readonly kind: 'tooLarge';
      readonly blocker: PlainBlocker;
    });

@Injectable()
export class ScopedCatalogueReader {
  constructor(
    private readonly snapshotReader: ChangesSnapshotReader,
    private readonly readScope: ReadScope,
    private readonly limits: PartialChangesLimits,
  ) {}

  public async readCatalogue(
    compared: ComparedSnapshot,
    selection: Selection,
  ): Promise<ScopedCatalogue> {
    const scope = this.readScope.scopeOf(selection, compared);
    const counts = await this.countsOf(scope);

    if (counts.changedRowCount > this.limits.maxChangedRows) {
      return {
        ...counts,
        kind: 'tooLarge',
        blocker: changedRowsTooLarge(
          counts.changedRowCount,
          this.limits.maxChangedRows,
        ),
      };
    }

    return {
      ...counts,
      kind: 'catalogue',
      catalogue: await this.buildCatalogue(compared, scope),
    };
  }

  private async countsOf(scope: TableScope): Promise<ScopeCounts> {
    return {
      changedRowCount: await this.snapshotReader.countChangedRows(
        scope.affectedTables,
      ),
    };
  }

  private async buildCatalogue(
    compared: ComparedSnapshot,
    scope: TableScope,
  ): Promise<ChangeCatalogue> {
    const changedRows = await this.snapshotReader.readChangedRows(
      scope.affectedTables,
    );

    return buildChangeCatalogue({ ...compared, changedRows });
  }
}
