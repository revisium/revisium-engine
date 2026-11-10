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
import {
  withCause,
  causeOf,
  positionOf,
  type ReasonSite,
  type ReferencedEntity,
} from 'src/features/partial-changes/plan/reason';
import { publicTableIdOf } from 'src/features/partial-changes/snapshot/changes-snapshot';

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
    const site: ReasonSite = {
      kind: 'schema',
      tableId: publicTableIdOf(referrer.pair),
    };
    const references: ReferencedEntity = { kind: 'table', tableId };

    if (structure !== undefined && !rules.isApplied(structure)) {
      return requiring(
        structure,
        withCause(
          {
            code: 'referrerStillReferences',
            because: this.brokenReference(
              context,
              referrer,
              tableId,
              `which the ${names.target} no longer contains`,
            ),
            site,
            references,
          },
          context.appliedCause(
            causeOf(
              this.structureMeantBy(context, referrer, tableId),
              'remover',
            ),
          ),
        ),
      );
    }

    const provider = this.unappliedStructureMeantBy(context, referrer, tableId);

    if (provider !== undefined) {
      return requiring(
        provider,
        withCause(
          {
            code: 'referencedTableMissing',
            because: this.brokenReference(
              context,
              referrer,
              tableId,
              `which exists only in ${names.other}`,
            ),
            site,
            references,
          },
          context.appliedCause(causeOf(structure, 'referrer')),
        ),
      );
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
        positionOf(site),
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
    const reference = `the schema of ${publicTableIdOf(referrer.pair)} references the table ${tableId}`;

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
    const structure = this.structureMeantBy(context, referrer, tableId);

    if (structure === undefined || context.rules.isApplied(structure)) {
      return undefined;
    }

    return structure;
  }

  private structureMeantBy(
    context: CheckContext,
    referrer: TargetTable,
    tableId: string,
  ): string | undefined {
    const meant = context.tables.tableMeantBy(referrer, tableId);

    return meant && context.structureOf(meant);
  }
}
