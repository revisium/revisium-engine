import { Injectable } from '@nestjs/common';
import type {
  CheckContext,
  TargetCheck,
  TargetChecking,
} from 'src/features/partial-changes/closure/check-context';
import {
  blocking,
  danglingInSource,
  type Finding,
  refusedBy,
  requiring,
} from 'src/features/partial-changes/closure/findings';
import type { TargetTable } from 'src/features/partial-changes/closure/target-tables';

@Injectable()
export class TableReferences implements TargetCheck, TargetChecking {
  public checkingOf(): TargetChecking {
    return this;
  }

  public findingsOf(context: CheckContext): Promise<Finding[]> {
    const { tables, schemas } = context;

    return Promise.resolve(
      tables.all.flatMap((referrer) =>
        schemas
          .referencedTablesOf(referrer.version)
          .filter((tableId) => !tables.referencedBy(referrer, tableId))
          .map((tableId) =>
            this.restoreTableReference(context, referrer, tableId),
          ),
      ),
    );
  }

  private restoreTableReference(
    context: CheckContext,
    referrer: TargetTable,
    tableId: string,
  ): Finding {
    const { rules, names } = context;
    const structure = context.structureOf(referrer.pair);
    const tableIdSite = { tableId: referrer.tableId };

    if (structure !== undefined && !rules.isApplied(structure)) {
      return requiring(structure, {
        ...tableIdSite,
        code: 'referrerStillReferences',
        because: this.brokenReference(
          context,
          referrer,
          tableId,
          `which the ${names.target} no longer contains`,
        ),
      });
    }

    const provider = this.unappliedStructureMeantBy(context, referrer, tableId);

    if (provider !== undefined) {
      return requiring(provider, {
        ...tableIdSite,
        code: 'referencedTableMissing',
        because: this.brokenReference(
          context,
          referrer,
          tableId,
          `which exists only in ${names.other}`,
        ),
      });
    }

    const refusal = context.tables.refusalOfReference(referrer, tableId);

    if (refusal) {
      return refusedBy(refusal);
    }

    return blocking(
      danglingInSource(
        this.brokenReference(
          context,
          referrer,
          tableId,
          `which the ${names.target} does not contain`,
        ),
        tableIdSite,
        structure,
      ),
    );
  }

  private brokenReference(
    { tables, names }: CheckContext,
    referrer: TargetTable,
    tableId: string,
    whichWhenMissing: string,
  ): string {
    const reference = `the schema of ${referrer.tableId} references the table ${tableId}`;

    if (tables.named(tableId) !== undefined) {
      return `${reference}, which is another table in the ${names.target}`;
    }

    return `${reference}, ${whichWhenMissing}`;
  }

  private unappliedStructureMeantBy(
    context: CheckContext,
    referrer: TargetTable,
    tableId: string,
  ): string | undefined {
    const meant = context.tables.tableMeantBy(referrer, tableId);
    const structure = meant && context.structureOf(meant);

    if (structure === undefined || context.rules.isApplied(structure)) {
      return undefined;
    }

    return structure;
  }
}
