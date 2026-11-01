import { Injectable } from '@nestjs/common';
import type { CatalogueRow } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type {
  CheckContext,
  TargetCheck,
  TargetChecking,
} from 'src/features/partial-changes/closure/check-context';
import {
  type Finding,
  requiringOrDangling,
} from 'src/features/partial-changes/closure/findings';
import {
  idUnitOf,
  type TargetTable,
} from 'src/features/partial-changes/closure/target-tables';

@Injectable()
export class RowIdCollisions implements TargetCheck, TargetChecking {
  public checkingOf(): TargetChecking {
    return this;
  }

  public findingsOf(context: CheckContext): Promise<Finding[]> {
    return Promise.resolve(
      context.tables.all.flatMap((table) =>
        table
          .collisions()
          .flatMap(({ id, rows }) =>
            rows
              .filter(({ row }) => this.keepsBaseId(context, row, id))
              .map(({ row }) =>
                this.moveFromOccupiedId(context, table, row, id),
              ),
          ),
      ),
    );
  }

  private keepsBaseId(
    { rules }: CheckContext,
    row: CatalogueRow,
    id: string,
  ): boolean {
    const unit = idUnitOf(row);

    return (
      row.pair[rules.baseSide]?.id === id &&
      (unit === undefined || !rules.isApplied(unit))
    );
  }

  private moveFromOccupiedId(
    context: CheckContext,
    { tableId }: TargetTable,
    row: CatalogueRow,
    rowId: string,
  ): Finding {
    return requiringOrDangling(idUnitOf(row), {
      code: 'idOccupied',
      tableId,
      rowId,
      because: `${tableId}/${rowId} would be held by two rows in the ${context.names.target}`,
    });
  }
}
