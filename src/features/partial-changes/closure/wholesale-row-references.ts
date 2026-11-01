import { Injectable } from '@nestjs/common';
import type {
  CheckContext,
  TargetCheck,
  TargetChecking,
} from 'src/features/partial-changes/closure/check-context';
import type { Finding } from 'src/features/partial-changes/closure/findings';
import { referencedRowFinding } from 'src/features/partial-changes/closure/row-reference';
import type { ForeignKeyLeaf } from 'src/features/partial-changes/closure/table-schemas';
import type { TargetTable } from 'src/features/partial-changes/closure/target-tables';
import { UnresolvedReferences } from 'src/features/partial-changes/closure/unresolved-references';
import { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';

interface WholesaleRowsScan {
  readonly referrer: TargetTable;
  readonly jsonPath: string;
  readonly referenced: TargetTable;
}

@Injectable()
export class WholesaleRowReferences implements TargetCheck {
  constructor(private readonly snapshotReader: ChangesSnapshotReader) {}

  public checkingOf(): TargetChecking {
    return new WholesaleRowReferencesChecking(
      new UnresolvedReferences(this.snapshotReader),
    );
  }
}

class WholesaleRowReferencesChecking implements TargetChecking {
  constructor(private readonly references: UnresolvedReferences) {}

  public async findingsOf(context: CheckContext): Promise<Finding[]> {
    const findings: Finding[] = [];

    for (const scan of this.wholesaleRowsScans(context)) {
      const unresolved = await this.references.from(
        scan.referrer,
        scan.jsonPath,
        scan.referenced,
      );

      for (const { referencedId, rowId } of unresolved) {
        if (!scan.referenced.holds(referencedId)) {
          findings.push(
            this.bringReferencedRow(context, scan, referencedId, rowId),
          );
        }
      }
    }

    return findings;
  }

  private wholesaleRowsScans(context: CheckContext): WholesaleRowsScan[] {
    return context.tables.all
      .filter((table) => table.takesOtherSideStructure())
      .flatMap((referrer) =>
        context.schemas
          .referencedTablesOf(referrer.version)
          .flatMap((tableId) => this.scansOf(context, referrer, tableId)),
      );
  }

  private scansOf(
    context: CheckContext,
    referrer: TargetTable,
    tableId: string,
  ): WholesaleRowsScan[] {
    const referenced = context.tables.referencedBy(referrer, tableId);

    if (!referenced) {
      return [];
    }

    return this.foreignKeysBroughtWholesale(context, referrer, tableId).map(
      ({ jsonPath }) => ({ referrer, jsonPath, referenced }),
    );
  }

  private foreignKeysBroughtWholesale(
    context: CheckContext,
    referrer: TargetTable,
    tableId: string,
  ): ForeignKeyLeaf[] {
    const leaves = context.schemas.foreignKeyLeavesOf(
      referrer.version,
      tableId,
    );

    if (referrer.isBroughtWholesale()) {
      return leaves;
    }

    return leaves.filter(({ pointer }) => referrer.isChangedField(pointer));
  }

  private bringReferencedRow(
    context: CheckContext,
    { referrer, referenced }: WholesaleRowsScan,
    referencedId: string,
    rowId: string,
  ): Finding {
    return referencedRowFinding(
      { site: { tableId: referrer.tableId, rowId }, referenced, referencedId },
      context.names,
      context.structureOf(referrer.pair),
    );
  }
}
