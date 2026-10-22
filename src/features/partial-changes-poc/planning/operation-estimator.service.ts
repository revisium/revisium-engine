import { Injectable } from '@nestjs/common';
import { sql } from 'src/engine-prisma-types';
import {
  TargetState,
  TargetTable,
} from 'src/features/partial-changes-poc/assembly/target.types';
import {
  Blocker,
  MixedTableEstimate,
  OperationEstimate,
} from 'src/features/partial-changes-poc/partial-changes.types';
import { OperationLimitValues } from 'src/features/partial-changes-poc/planning/operation-limits.service';
import { ChangesSnapshot } from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import { schemaUsesFormulas } from 'src/features/partial-changes-poc/write/schema-files';
import {
  copiesLinks,
  MixedTableRows,
  splitMixedTableRows,
  writesMixedTable,
} from 'src/features/partial-changes-poc/write/mixed-table-rows';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@Injectable()
export class OperationEstimator {
  constructor(private readonly transactionService: TransactionPrismaService) {}

  private get db() {
    return this.transactionService.getTransaction();
  }

  async estimate(
    snapshot: ChangesSnapshot,
    state: TargetState,
  ): Promise<OperationEstimate> {
    const estimate: OperationEstimate = {
      changedRows: snapshot.changedRowCount,
      mergedRows: 0,
      mergedRowsWithFormulas: 0,
      mixedTables: [],
    };

    for (const target of state.tables) {
      if (!writesMixedTable(target, state.operation)) {
        continue;
      }
      const rows = splitMixedTableRows(target);
      estimate.mergedRows += rows.merged.length;
      if (target.table.kind !== 'system' && schemaUsesFormulas(target.schema)) {
        estimate.mergedRowsWithFormulas += rows.merged.length;
      }
      estimate.mixedTables.push(
        await this.mixedTableEstimate(target, state, rows),
      );
    }

    return estimate;
  }

  private async mixedTableEstimate(
    target: TargetTable,
    state: TargetState,
    rows: MixedTableRows,
  ): Promise<MixedTableEstimate> {
    return {
      tableId: target.publicId ?? target.table.tableId,
      linksCopied: copiesLinks(target, state.operation)
        ? (await this.linkCount(target)) - rows.dropBaseVersionIds.length
        : 0,
      linksAdded: rows.linkOtherVersionIds.length + rows.merged.length,
    };
  }

  private async linkCount(target: TargetTable): Promise<number> {
    const source =
      target.linkSide === 'head'
        ? target.table.pair.head
        : target.table.pair.draft;
    if (!source) {
      return 0;
    }
    const [counted] = await this.db.$queryRaw<{ count: number }[]>(sql`
      SELECT count(*)::int AS "count" FROM "_RowToTable" WHERE "B" = ${source.versionId}
    `);
    return counted?.count ?? 0;
  }
}

export function tooLargeBlockers(
  estimate: OperationEstimate,
  limits: OperationLimitValues,
): Blocker[] {
  const blockers: Blocker[] = [];
  if (estimate.changedRows > limits.maxChangedRows) {
    blockers.push(changedRowsBlocker(estimate.changedRows, limits));
  }
  if (estimate.mergedRowsWithFormulas > limits.maxFormulaMerges) {
    blockers.push({
      code: 'tooLarge',
      message: `The operation merges ${estimate.mergedRowsWithFormulas} rows of tables with formula fields; the limit for one operation is ${limits.maxFormulaMerges}`,
    });
  }
  for (const table of estimate.mixedTables) {
    if (table.linksCopied > limits.maxMixedTableLinks) {
      blockers.push({
        code: 'tooLarge',
        tableId: table.tableId,
        message: `Assembling ${table.tableId} copies ${table.linksCopied} row links; the limit for one table is ${limits.maxMixedTableLinks}`,
      });
    }
  }
  return blockers;
}

export function changedRowsBlocker(
  changedRows: number,
  limits: OperationLimitValues,
): Blocker {
  return {
    code: 'tooLarge',
    message: `The Draft has ${changedRows} changed rows; the limit for one operation is ${limits.maxChangedRows}`,
  };
}
