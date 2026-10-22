import { Injectable } from '@nestjs/common';
import { RowMerger } from 'src/features/partial-changes-poc/assembly/row-merger.service';
import {
  Direction,
  RowOutcome,
  TableOutcome,
  TargetRow,
  TargetState,
  TargetTable,
} from 'src/features/partial-changes-poc/assembly/target.types';
import {
  CatalogueRow,
  CatalogueTable,
  ChangeCatalogue,
} from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import { sideOf } from 'src/features/partial-changes-poc/snapshot/snapshot.types';

export interface AssemblyInput {
  catalogue: ChangeCatalogue;
  direction: Direction;
  applied: ReadonlySet<string>;
  preferOtherForUnitlessTables: boolean;
}

@Injectable()
export class TargetAssembler {
  constructor(private readonly rowMerger: RowMerger) {}

  assemble(input: AssemblyInput): TargetState {
    const tables = [...input.catalogue.tables.values()].map((table) =>
      this.assembleTable(table, input),
    );
    return { direction: input.direction, tables };
  }

  private assembleTable(
    table: CatalogueTable,
    input: AssemblyInput,
  ): TargetTable {
    const rows = [...table.rows.values()].map((row) => ({
      row,
      outcome: this.assembleRow(table, row, input),
    }));

    return { table, outcome: this.tableOutcome(table, rows, input), rows };
  }

  private tableOutcome(
    table: CatalogueTable,
    rows: TargetRow[],
    input: AssemblyInput,
  ): TableOutcome {
    if (table.kind === 'unchanged') {
      return 'unchanged';
    }

    const appliedCount = table.unitKeys.filter((key) =>
      input.applied.has(key),
    ).length;

    if (table.unitKeys.length === 0) {
      return input.preferOtherForUnitlessTables ? 'other' : 'base';
    }

    if (appliedCount === 0) {
      return 'base';
    }

    if (appliedCount === table.unitKeys.length && this.allRowsFromOther(rows)) {
      return 'other';
    }

    return table.kind === 'system' ? 'mixedSystemUnsupported' : 'mixed';
  }

  private allRowsFromOther(rows: TargetRow[]): boolean {
    return rows.every(
      ({ outcome }) => outcome.kind === 'other' || outcome.kind === 'absent',
    );
  }

  private assembleRow(
    table: CatalogueTable,
    row: CatalogueRow,
    input: AssemblyInput,
  ): RowOutcome {
    const base = sideOf(row.pair, input.direction.base);
    const other = sideOf(row.pair, input.direction.other);

    if (row.existenceUnit && input.applied.has(row.existenceUnit)) {
      return other ? { kind: 'other', version: other } : { kind: 'absent' };
    }

    if (!base) {
      return { kind: 'absent' };
    }

    if (!other) {
      return { kind: 'base', version: base };
    }

    const renameApplied = Boolean(
      row.renameUnit && input.applied.has(row.renameUnit),
    );
    const paths = [...row.fieldUnits]
      .filter(([, key]) => input.applied.has(key))
      .map(([path]) => path);

    if (!renameApplied && paths.length === 0) {
      return { kind: 'base', version: base };
    }

    if (
      (!row.renameUnit || renameApplied) &&
      paths.length === row.fieldUnits.size
    ) {
      return { kind: 'other', version: other };
    }

    const merged = this.rowMerger.merge({
      schema: table.schema ?? {},
      base,
      other,
      paths,
      takeOtherId: renameApplied,
    } as Parameters<RowMerger['merge']>[0]);

    if (merged.hash === other.hash && merged.id === other.id) {
      return { kind: 'other', version: other };
    }

    if (merged.hash === base.hash && merged.id === base.id) {
      return { kind: 'base', version: base };
    }

    return { kind: 'merged', ...merged, base, idFromOther: renameApplied };
  }
}
