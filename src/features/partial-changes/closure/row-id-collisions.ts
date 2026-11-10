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
  type IdCollision,
  idUnitOf,
  type TargetTable,
} from 'src/features/partial-changes/closure/target-tables';
import { withCause, causeOf } from 'src/features/partial-changes/plan/reason';
import { publicTableIdOf } from 'src/features/partial-changes/snapshot/changes-snapshot';

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
          .flatMap((collision) =>
            collision.rows
              .filter(({ row }) => this.keepsBaseId(context, row, collision.id))
              .map(({ row }) =>
                this.moveFromOccupiedId(context, table, row, collision),
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
    { pair }: TargetTable,
    row: CatalogueRow,
    { id: rowId, rows }: IdCollision,
  ): Finding {
    const tableId = publicTableIdOf(pair);

    return requiringOrDangling(
      idUnitOf(row),
      withCause(
        {
          code: 'idOccupied',
          because: `${tableId}/${rowId} would be held by two rows in the ${context.names.target}`,
          site: { kind: 'rowId', tableId, rowId },
        },
        causeOf(
          context.appliedUnitAmong(rows.map((held) => idUnitOf(held.row))),
          'taker',
        ),
      ),
    );
  }
}
