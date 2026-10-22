import { Injectable } from '@nestjs/common';
import { sql } from 'src/engine-prisma-types';
import {
  OutcomeInput,
  PlannedOutcomeKind,
  plannedKind,
  planRow,
  planTable,
  settledOutcome,
  TablePlan,
  tableOutcomeOf,
} from 'src/features/partial-changes-poc/assembly/outcome-plan';
import {
  CatalogueRow,
  CatalogueTable,
  schemaOfSide,
} from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import {
  Blocker,
  MixedTableEstimate,
  OperationEstimate,
} from 'src/features/partial-changes-poc/partial-changes.types';
import { OperationLimitValues } from 'src/features/partial-changes-poc/planning/operation-limits.service';
import { sideOf } from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import {
  schemaUsesFiles,
  schemaUsesFormulas,
} from 'src/features/partial-changes-poc/write/schema-files';
import { copiesLinks } from 'src/features/partial-changes-poc/write/mixed-table-rows';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

export interface EstimateInput extends OutcomeInput {
  changedRows: number;
  linkCounts: Map<string, number>;
}

interface PlannedRow {
  row: CatalogueRow;
  kind: PlannedOutcomeKind;
}

@Injectable()
export class OperationEstimator {
  constructor(private readonly transactionService: TransactionPrismaService) {}

  private get db() {
    return this.transactionService.getTransaction();
  }

  async estimate(input: EstimateInput): Promise<OperationEstimate> {
    const estimate: OperationEstimate = {
      changedRows: input.changedRows,
      mergedRows: 0,
      perRowWorkRows: 0,
      mixedTables: [],
    };

    for (const table of input.catalogue.tables.values()) {
      if (table.kind !== 'data') {
        continue;
      }
      const plan = planTable(table, input);
      const rows = plannedRows(table, plan);
      const { outcome } = settledOutcome(
        table,
        tableOutcomeOf(table, plan, rows),
        plan.linkSide,
        input,
      );
      if (outcome !== 'mixed') {
        continue;
      }
      const merged = rows.filter(({ kind }) => kind === 'merged').length;
      estimate.mergedRows += merged;
      if (needsPerRowWork(table, plan)) {
        estimate.perRowWorkRows += merged;
      }
      estimate.mixedTables.push(
        await this.mixedTableEstimate(table, plan, rows, input),
      );
    }

    return estimate;
  }

  private async mixedTableEstimate(
    table: CatalogueTable,
    plan: TablePlan,
    rows: PlannedRow[],
    input: EstimateInput,
  ): Promise<MixedTableEstimate> {
    const publicId = sideOf(table.pair, plan.linkSide)?.id;
    const replaced = rows.filter(
      ({ row, kind }) => kind !== 'base' && sideOf(row.pair, plan.linkSide),
    ).length;
    const copies = copiesLinks(
      { table, linkSide: plan.linkSide, publicId },
      input.operation,
    );

    return {
      tableId: publicId ?? table.tableId,
      linksCopied: copies
        ? (await this.linkCount(table, plan, input.linkCounts)) - replaced
        : 0,
      linksAdded: rows.filter(
        ({ kind }) => kind === 'other' || kind === 'merged',
      ).length,
    };
  }

  private async linkCount(
    table: CatalogueTable,
    plan: TablePlan,
    cache: Map<string, number>,
  ): Promise<number> {
    const source = sideOf(table.pair, plan.linkSide);
    if (!source) {
      return 0;
    }
    const cached = cache.get(source.versionId);
    if (cached !== undefined) {
      return cached;
    }
    const [counted] = await this.db.$queryRaw<{ count: number }[]>(sql`
      SELECT count(*)::int AS "count" FROM "_RowToTable" WHERE "B" = ${source.versionId}
    `);
    const count = counted?.count ?? 0;
    cache.set(source.versionId, count);
    return count;
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
  if (estimate.perRowWorkRows > limits.maxPerRowWork) {
    blockers.push({
      code: 'tooLarge',
      message: `The operation merges ${estimate.perRowWorkRows} rows that need per-row work (formula fields or file registration); the limit for one operation is ${limits.maxPerRowWork}`,
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
    message: `The operation reads ${changedRows} changed rows; the limit for one operation is ${limits.maxChangedRows}`,
  };
}

function plannedRows(table: CatalogueTable, plan: TablePlan): PlannedRow[] {
  return [...table.rows.values()].map((row) => ({
    row,
    kind: plannedKind(planRow(row, plan)),
  }));
}

function needsPerRowWork(table: CatalogueTable, plan: TablePlan): boolean {
  const schema = schemaOfSide(table.pair, plan.linkSide);
  return schemaUsesFormulas(schema) || schemaUsesFiles(schema);
}
