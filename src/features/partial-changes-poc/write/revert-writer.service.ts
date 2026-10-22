import { Injectable } from '@nestjs/common';
import { TargetTable } from 'src/features/partial-changes-poc/assembly/target.types';
import { ChangePlan } from 'src/features/partial-changes-poc/planning/change-planner.service';
import { TableVersion } from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import { splitMixedTableRows } from 'src/features/partial-changes-poc/write/mixed-table-rows';
import { VersionWriter } from 'src/features/partial-changes-poc/write/version-writer.service';
import { FileUsageIntegrationService } from 'src/features/file-usage/services/file-usage-integration.service';
import { DiffService } from 'src/features/share/diff.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

interface TableLinkChange {
  disconnect?: string;
  connect?: string;
}

@Injectable()
export class RevertWriter {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly versionWriter: VersionWriter,
    private readonly diffService: DiffService,
    private readonly fileUsageIntegration: FileUsageIntegrationService,
  ) {}

  private get db() {
    return this.transactionService.getTransaction();
  }

  async write(plan: ChangePlan): Promise<{ draftRevisionId: string }> {
    const { draftRevisionId, headRevisionId } = plan.snapshot;
    const linkChanges: TableLinkChange[] = [];

    for (const target of plan.target.tables) {
      const change = await this.revertTable(plan, target);
      if (change) {
        linkChanges.push(change);
      }
    }

    await this.relinkDraftTables(draftRevisionId, linkChanges);
    await this.recomputeDraftHasChanges(headRevisionId, draftRevisionId);
    return { draftRevisionId };
  }

  private async revertTable(
    plan: ChangePlan,
    target: TargetTable,
  ): Promise<TableLinkChange | undefined> {
    const { head, draft } = target.table.pair;

    switch (target.outcome) {
      case 'unchanged':
      case 'base':
        return undefined;
      case 'other':
        return { disconnect: draft?.versionId, connect: head?.versionId };
      case 'mixed':
        return this.revertMixedTable(plan, target);
      default:
        throw new Error(`Cannot revert table ${target.table.tableId}`);
    }
  }

  private async revertMixedTable(
    plan: ChangePlan,
    target: TargetTable,
  ): Promise<TableLinkChange | undefined> {
    const draft = target.table.pair.draft;
    if (!draft) {
      throw new Error(`Table ${target.table.tableId} has no Draft version`);
    }

    const rows = splitMixedTableRows(target, plan.direction);
    const { tableVersionId, change } = await this.writableDraftTable(
      draft,
      rows.dropBaseVersionIds,
    );

    const mergedVersionIds = await this.versionWriter.createRowVersions(
      rows.merged,
      false,
    );
    await this.versionWriter.linkRows(tableVersionId, [
      ...rows.linkOtherVersionIds,
      ...mergedVersionIds,
    ]);

    await this.fileUsageIntegration.registerReferencesForRowVersions({
      revisionId: plan.snapshot.draftRevisionId,
      tableId: draft.id,
      rowVersionIds: mergedVersionIds,
    });

    return change;
  }

  private async writableDraftTable(
    draft: TableVersion,
    dropRowVersionIds: string[],
  ): Promise<{ tableVersionId: string; change?: TableLinkChange }> {
    if (!draft.readonly) {
      await this.versionWriter.unlinkRows(draft.versionId, dropRowVersionIds);
      return { tableVersionId: draft.versionId };
    }

    const tableVersionId = await this.versionWriter.createTableVersion({
      source: draft,
      copyLinksFrom: draft.versionId,
      withoutRowVersionIds: dropRowVersionIds,
      readonly: false,
    });
    return {
      tableVersionId,
      change: { disconnect: draft.versionId, connect: tableVersionId },
    };
  }

  private async relinkDraftTables(
    draftRevisionId: string,
    changes: TableLinkChange[],
  ): Promise<void> {
    const disconnect = changes
      .map((change) => change.disconnect)
      .filter((versionId): versionId is string => versionId !== undefined);
    const connect = changes
      .map((change) => change.connect)
      .filter((versionId): versionId is string => versionId !== undefined);

    if (disconnect.length === 0 && connect.length === 0) {
      return;
    }

    await this.db.revision.update({
      where: { id: draftRevisionId },
      data: {
        tables: {
          disconnect: disconnect.map((versionId) => ({ versionId })),
          connect: connect.map((versionId) => ({ versionId })),
        },
      },
    });
  }

  private async recomputeDraftHasChanges(
    headRevisionId: string,
    draftRevisionId: string,
  ): Promise<void> {
    const hasChanges = await this.diffService.hasTableDiffs({
      fromRevisionId: headRevisionId,
      toRevisionId: draftRevisionId,
    });

    await this.db.revision.update({
      where: { id: draftRevisionId },
      data: { hasChanges },
    });
  }
}
