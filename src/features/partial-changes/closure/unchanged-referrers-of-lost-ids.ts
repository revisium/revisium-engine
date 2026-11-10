import { Injectable } from '@nestjs/common';
import type {
  CheckContext,
  TargetCheck,
  TargetChecking,
} from 'src/features/partial-changes/closure/check-context';
import {
  type Finding,
  refusedBy,
  requiring,
  requiringOrDangling,
} from 'src/features/partial-changes/closure/findings';
import { LostIdReferrers } from 'src/features/partial-changes/closure/lost-id-referrers';
import {
  referenceReason,
  referringSiteOf,
} from 'src/features/partial-changes/closure/row-reference';
import type { ForeignKeyLeaf } from 'src/features/partial-changes/closure/table-schemas';
import type { TargetTable } from 'src/features/partial-changes/closure/target-tables';
import type { RefusedTable } from 'src/features/partial-changes/head-schema/head-schema-check';
import { causeOf } from 'src/features/partial-changes/plan/reason';
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
          findings.push(await this.restoreLostId(context, scan, lostId, rowId));
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

  private async restoreLostId(
    context: CheckContext,
    scan: ReferrerScan,
    referencedId: string,
    rowId: string,
  ): Promise<Finding> {
    const { losing, referrer, leaf } = scan;
    const structure = context.unappliedStructureHolding(referrer, leaf.pointer);
    const { target } = context.names;
    const reference = {
      site: referringSiteOf(referrer, rowId, leaf.pointer),
      referenced: losing,
      referencedId,
    };
    const culprit = losing.unitLosing(referencedId);
    const cause = context.appliedCause(causeOf(culprit, 'remover'));

    if (structure !== undefined) {
      return requiring(
        structure,
        referenceReason(
          reference,
          'structureBoundData',
          `which the ${target} loses; the value follows the structure of ${reference.site.tableId}`,
          cause,
        ),
      );
    }

    const provider = losing.providerOf(referencedId);
    const refusal =
      provider === undefined
        ? await this.refusalOfReferrerChange(context, scan, referencedId)
        : undefined;

    if (refusal) {
      return refusedBy(refusal);
    }

    return requiringOrDangling(
      provider,
      referenceReason(
        reference,
        'referencedRowMissing',
        `which the ${target} loses`,
        cause,
      ),
      culprit,
    );
  }

  private async refusalOfReferrerChange(
    { schemas }: CheckContext,
    { losing, referrer }: ReferrerScan,
    referencedId: string,
  ): Promise<RefusedTable | undefined> {
    if (!referrer.refusal) {
      return undefined;
    }

    const referencedOnOtherSide = await this.referrers.otherSideReferencesOf(
      referrer,
      losing,
      schemas,
    );

    return referencedOnOtherSide.has(referencedId)
      ? undefined
      : referrer.refusal;
  }
}
