import { Injectable } from '@nestjs/common';
import { TargetTable } from 'src/features/partial-changes-poc/assembly/target.types';
import { ChangePlan } from 'src/features/partial-changes-poc/planning/change-planner.service';
import {
  TableVersion,
  oppositeOf,
  sideOf,
} from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import {
  editsDraftInPlace,
  MixedTableRows,
  splitMixedTableRows,
} from 'src/features/partial-changes-poc/write/mixed-table-rows';
import {
  registerFileReferences,
  RowsWithFiles,
  rowsWithFiles,
} from 'src/features/partial-changes-poc/write/file-references';
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
    const filesToRegister: RowsWithFiles[] = [];

    for (const target of plan.target.tables) {
      const change = await this.revertTable(target, filesToRegister);
      if (change) {
        linkChanges.push(change);
      }
    }

    await this.relinkDraftTables(draftRevisionId, linkChanges);
    await registerFileReferences(
      this.fileUsageIntegration,
      draftRevisionId,
      filesToRegister,
    );
    await this.recomputeDraftHasChanges(headRevisionId, draftRevisionId);
    return { draftRevisionId };
  }

  private async revertTable(
    target: TargetTable,
    filesToRegister: RowsWithFiles[],
  ): Promise<TableLinkChange | undefined> {
    const { head, draft } = target.table.pair;
    if (target.draftFollowsHead) {
      return this.replaceDraftVersion(draft, head);
    }

    switch (target.outcome) {
      case 'unchanged':
        return undefined;
      case 'absent':
        return draft ? { disconnect: draft.versionId } : undefined;
      case 'base':
        return this.replaceDraftVersion(
          draft,
          sideOf(target.table.pair, target.linkSide),
        );
      case 'other':
        return this.replaceDraftVersion(
          draft,
          sideOf(target.table.pair, oppositeOf(target.linkSide)),
        );
      case 'mixed':
        return target.linkSide === 'draft'
          ? this.revertMixedDraftTable(target, filesToRegister)
          : this.assembleMixedDraftTable(target, head, filesToRegister);
      default:
        throw new Error(`Cannot revert table ${target.table.tableId}`);
    }
  }

  private replaceDraftVersion(
    draft: TableVersion | undefined,
    next: TableVersion | undefined,
  ): TableLinkChange | undefined {
    if (draft?.versionId === next?.versionId) {
      return undefined;
    }
    return { disconnect: draft?.versionId, connect: next?.versionId };
  }

  private async revertMixedDraftTable(
    target: TargetTable,
    filesToRegister: RowsWithFiles[],
  ): Promise<TableLinkChange | undefined> {
    const draft = target.table.pair.draft;
    if (!draft) {
      throw new Error(`Table ${target.table.tableId} has no Draft version`);
    }

    const rows = splitMixedTableRows(target);
    const { tableVersionId, change } = await this.writableDraftTable(
      draft,
      target.publicId,
      rows.dropBaseVersionIds,
    );
    const mergedVersionIds = await this.addRows(tableVersionId, rows);
    filesToRegister.push(...rowsWithFiles(target, mergedVersionIds));
    return change;
  }

  private async assembleMixedDraftTable(
    target: TargetTable,
    head: TableVersion | undefined,
    filesToRegister: RowsWithFiles[],
  ): Promise<TableLinkChange> {
    if (!head) {
      throw new Error(`Table ${target.table.tableId} has no Head version`);
    }

    const rows = splitMixedTableRows(target);
    const tableVersionId = await this.versionWriter.createTableVersion({
      source: head,
      id: target.publicId,
      copyLinksFrom: head.versionId,
      withoutRowVersionIds: rows.dropBaseVersionIds,
      readonly: false,
    });
    const mergedVersionIds = await this.addRows(tableVersionId, rows);
    filesToRegister.push(...rowsWithFiles(target, mergedVersionIds));
    return {
      disconnect: target.table.pair.draft?.versionId,
      connect: tableVersionId,
    };
  }

  private async addRows(
    tableVersionId: string,
    rows: MixedTableRows,
  ): Promise<string[]> {
    const mergedVersionIds = await this.versionWriter.createRowVersions(
      rows.merged,
      false,
    );
    await this.versionWriter.linkRows(tableVersionId, [
      ...rows.linkOtherVersionIds,
      ...mergedVersionIds,
    ]);
    return mergedVersionIds;
  }

  private async writableDraftTable(
    draft: TableVersion,
    id: string | undefined,
    dropRowVersionIds: string[],
  ): Promise<{ tableVersionId: string; change?: TableLinkChange }> {
    if (editsDraftInPlace(draft, id)) {
      await this.versionWriter.unlinkRows(draft.versionId, dropRowVersionIds);
      return { tableVersionId: draft.versionId };
    }

    const tableVersionId = await this.versionWriter.createTableVersion({
      source: draft,
      id,
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
