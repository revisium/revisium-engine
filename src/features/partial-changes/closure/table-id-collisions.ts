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
import { causeOf, withCause } from 'src/features/partial-changes/plan/reason';

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
            .map((table) => this.moveFromOccupiedId(context, table, holders)),
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
    holders: readonly TargetTable[],
  ): Finding {
    if (refusal) {
      return refusedBy(refusal);
    }

    return requiringOrDangling(
      context.structureOf(pair),
      withCause(
        {
          code: 'idOccupied',
          because: `the table id ${tableId} would be held by two tables in the ${context.names.target}`,
          site: { kind: 'tableId', tableId },
        },
        causeOf(
          context.appliedUnitAmong(
            holders.map((holder) => context.structureOf(holder.pair)),
          ),
          'taker',
        ),
      ),
    );
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
