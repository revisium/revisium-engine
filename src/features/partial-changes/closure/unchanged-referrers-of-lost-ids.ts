import { Injectable } from '@nestjs/common';
import type {
  CheckContext,
  TargetCheck,
  TargetChecking,
} from 'src/features/partial-changes/closure/check-context';
import {
  type Finding,
  requiring,
  requiringOrDangling,
} from 'src/features/partial-changes/closure/findings';
import { LostIdReferrers } from 'src/features/partial-changes/closure/lost-id-referrers';
import { referenceReason } from 'src/features/partial-changes/closure/row-reference';
import type { ForeignKeyLeaf } from 'src/features/partial-changes/closure/table-schemas';
import type { TargetTable } from 'src/features/partial-changes/closure/target-tables';
import { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

interface ReferrerScan {
  readonly losing: TargetTable;
  readonly lostIds: readonly string[];
  readonly referrer: TargetTable;
  readonly leaf: ForeignKeyLeaf;
}

@Injectable()
export class UnchangedReferrersOfLostIds implements TargetCheck {
  constructor(private readonly snapshotReader: ChangesSnapshotReader) {}

  public checkingOf(): TargetChecking {
    return new UnchangedReferrersOfLostIdsChecking(
      new LostIdReferrers(this.snapshotReader),
    );
  }
}

class UnchangedReferrersOfLostIdsChecking implements TargetChecking {
  constructor(private readonly referrers: LostIdReferrers) {}

  public async findingsOf(context: CheckContext): Promise<Finding[]> {
    const findings: Finding[] = [];

    for (const scan of this.referrerScans(context)) {
      const referrers = await this.referrers.referrersOf(
        scan.referrer,
        scan.leaf.jsonPath,
        scan.losing,
      );

      for (const lostId of scan.lostIds) {
        const rowId = referrers.get(lostId);

        if (rowId !== undefined) {
          findings.push(this.restoreLostId(context, scan, lostId, rowId));
        }
      }
    }

    return findings;
  }

  private referrerScans(context: CheckContext): ReferrerScan[] {
    const { tables, schemas } = context;
    const referrers = tables.all.filter((table) => !table.isBroughtWholesale());

    return tables.all.flatMap((losing) => {
      const lostIds = losing.lostIds().sort(compareCodePoints);

      if (lostIds.length === 0) {
        return [];
      }

      return referrers
        .filter((referrer) => this.referencesLosing(context, referrer, losing))
        .flatMap((referrer) =>
          schemas
            .foreignKeyLeavesOf(referrer.version, losing.tableId)
            .map((leaf) => ({ losing, lostIds, referrer, leaf })),
        );
    });
  }

  private referencesLosing(
    { tables }: CheckContext,
    referrer: TargetTable,
    losing: TargetTable,
  ): boolean {
    return tables.referencedBy(referrer, losing.tableId) === losing;
  }

  private restoreLostId(
    context: CheckContext,
    { losing, referrer, leaf }: ReferrerScan,
    referencedId: string,
    rowId: string,
  ): Finding {
    const structure = context.unappliedStructureHolding(referrer, leaf.pointer);
    const { target } = context.names;
    const site = { tableId: referrer.tableId, rowId };

    if (structure !== undefined) {
      return requiring(
        structure,
        referenceReason(
          {
            site: { ...site, path: leaf.pointer.toString() },
            referenced: losing,
            referencedId,
          },
          'structureBoundData',
          `which the ${target} loses; the value follows the structure of ${referrer.tableId}`,
        ),
      );
    }

    return requiringOrDangling(
      losing.providerOf(referencedId),
      referenceReason(
        { site, referenced: losing, referencedId },
        'referencedRowMissing',
        `which the ${target} loses`,
      ),
      losing.unitLosing(referencedId),
    );
  }
}
