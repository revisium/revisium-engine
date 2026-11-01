import { Injectable } from '@nestjs/common';
import {
  buildChangeCatalogue,
  type ChangeCatalogue,
  type ComparedSnapshot,
} from 'src/features/partial-changes/catalogue/change-catalogue';
import { HeadViewsMigration } from 'src/features/partial-changes/catalogue/head-views-migration';
import { PartialChangesLimits } from 'src/features/partial-changes/limits/partial-changes-limits';
import { changedRowsTooLarge } from 'src/features/partial-changes/limits/too-large-blockers';
import {
  ReadScope,
  type TableScope,
} from 'src/features/partial-changes/scope/read-scope';
import type { Selection } from 'src/features/partial-changes/selection/selection';
import type { PlanBlocker } from 'src/features/partial-changes/selection/selection-resolution';
import { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';
import type { ChangedRows } from 'src/features/partial-changes/snapshot/changes-snapshot';
import { NativeSchemaRules } from 'src/features/share/ledger-replay/native-schema-rules';
import { ViewsMigrationService } from 'src/features/share/views-migration.service';

interface ScopeCounts {
  readonly changedRows: number;
  readonly unreadTables: number;
}

export type ScopedCatalogue =
  | (ScopeCounts & {
      readonly kind: 'catalogue';
      readonly catalogue: ChangeCatalogue;
    })
  | (ScopeCounts & {
      readonly kind: 'tooLarge';
      readonly blocker: PlanBlocker;
    });

@Injectable()
export class ScopedCatalogueReader {
  private readonly headViews: HeadViewsMigration;

  constructor(
    private readonly snapshotReader: ChangesSnapshotReader,
    private readonly readScope: ReadScope,
    private readonly limits: PartialChangesLimits,
    viewsMigration: ViewsMigrationService,
    schemaRules: NativeSchemaRules,
  ) {
    this.headViews = new HeadViewsMigration(viewsMigration, schemaRules);
  }

  public async readCatalogue(
    compared: ComparedSnapshot,
    selection: Selection,
  ): Promise<ScopedCatalogue> {
    const scope = this.readScope.scopeOf(selection, compared);
    const counts = await this.countsOf(scope);

    if (counts.changedRows > this.limits.maxChangedRows) {
      return {
        ...counts,
        kind: 'tooLarge',
        blocker: changedRowsTooLarge(
          counts.changedRows,
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
      changedRows: await this.snapshotReader.countChangedRows(
        scope.affectedTables,
      ),
      unreadTables: scope.unreadTables,
    };
  }

  private async buildCatalogue(
    compared: ComparedSnapshot,
    scope: TableScope,
  ): Promise<ChangeCatalogue> {
    const loaded = await this.snapshotReader.readChangedRows(
      scope.loadedTables,
    );

    return buildChangeCatalogue(
      { ...compared, changedRows: changedRowsOfAffectedTables(loaded, scope) },
      this.headViews,
    );
  }
}

function changedRowsOfAffectedTables(
  loaded: ChangedRows,
  { affectedTables }: TableScope,
): ChangedRows {
  const affected = new Set(affectedTables.map(({ identity }) => identity));

  return new Map([...loaded].filter(([identity]) => affected.has(identity)));
}
