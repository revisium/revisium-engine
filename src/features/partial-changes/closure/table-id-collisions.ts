import { Injectable } from '@nestjs/common';
import type {
  CheckContext,
  TargetCheck,
  TargetChecking,
} from 'src/features/partial-changes/closure/check-context';
import {
  type Finding,
  refusedBy,
  requiringOrDangling,
} from 'src/features/partial-changes/closure/findings';
import type { TargetTable } from 'src/features/partial-changes/closure/target-tables';

@Injectable()
export class TableIdCollisions implements TargetCheck, TargetChecking {
  public checkingOf(): TargetChecking {
    return this;
  }

  public findingsOf(context: CheckContext): Promise<Finding[]> {
    return Promise.resolve(
      [...holdersByTableId(context.tables.all).values()]
        .filter((holders) => holders.length > 1)
        .flatMap((holders) =>
          holders
            .filter((table) => this.keepsBaseId(context, table))
            .map((table) => this.moveFromOccupiedId(context, table)),
        ),
    );
  }

  private keepsBaseId(context: CheckContext, table: TargetTable): boolean {
    const structure = context.structureOf(table.pair);

    return (
      table.keepsBaseId() &&
      (structure === undefined || !context.rules.isApplied(structure))
    );
  }

  private moveFromOccupiedId(
    context: CheckContext,
    { tableId, pair, refusal }: TargetTable,
  ): Finding {
    if (refusal) {
      return refusedBy(refusal);
    }

    return requiringOrDangling(context.structureOf(pair), {
      code: 'idOccupied',
      tableId,
      because: `the table id ${tableId} would be held by two tables in the ${context.names.target}`,
    });
  }
}

function holdersByTableId(
  tables: readonly TargetTable[],
): Map<string, TargetTable[]> {
  const holders = new Map<string, TargetTable[]>();

  for (const table of tables) {
    holders.set(table.tableId, [...(holders.get(table.tableId) ?? []), table]);
  }

  return holders;
}
