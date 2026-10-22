import { Injectable } from '@nestjs/common';
import objectHash from 'object-hash';
import { TargetTable } from 'src/features/partial-changes-poc/assembly/target.types';
import { ChangePlan } from 'src/features/partial-changes-poc/planning/change-planner.service';
import {
  oppositeOf,
  sideOf,
  TableVersion,
} from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import {
  MixedTableRows,
  splitMixedTableRows,
} from 'src/features/partial-changes-poc/write/mixed-table-rows';
import {
  registerFileReferences,
  RowsWithFiles,
  rowsWithFiles,
} from 'src/features/partial-changes-poc/write/file-references';
import { SnapshotReader } from 'src/features/partial-changes-poc/snapshot/snapshot-reader.service';
import { VersionWriter } from 'src/features/partial-changes-poc/write/version-writer.service';
import { FileUsageIntegrationService } from 'src/features/file-usage/services/file-usage-integration.service';
import { DiffService } from 'src/features/share/diff.service';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { IdService } from 'src/infrastructure/database/id.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

export interface CommitWriteResult {
  previousHeadRevisionId: string;
  headRevisionId: string;
  draftRevisionId: string;
}

@Injectable()
export class CommitWriter {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly idService: IdService,
    private readonly versionWriter: VersionWriter,
    private readonly diffService: DiffService,
    private readonly fileUsageIntegration: FileUsageIntegrationService,
    private readonly snapshotReader: SnapshotReader,
  ) {}

  private get db() {
    return this.transactionService.getTransaction();
  }

  async write(plan: ChangePlan, comment?: string): Promise<CommitWriteResult> {
    const { snapshot } = plan;
    const headTables = new Map<TargetTable, string>();
    const filesToRegister: RowsWithFiles[] = [];

    for (const target of plan.target.tables) {
      const versionId = await this.headTableVersion(target, filesToRegister);
      if (versionId) {
        headTables.set(target, versionId);
      }
    }

    const draftTables = await this.nextDraftTableVersionIds(plan, headTables);
    await this.retirePreviousHead(snapshot.headRevisionId);
    await this.promoteDraftToHead(
      snapshot.draftRevisionId,
      [...headTables.values()],
      comment,
    );
    const nextDraftRevisionId = await this.createNextDraft(plan, draftTables);
    await registerFileReferences(
      this.fileUsageIntegration,
      snapshot.draftRevisionId,
      filesToRegister,
    );
    await this.recomputeNextDraftHasChanges(
      snapshot.draftRevisionId,
      nextDraftRevisionId,
    );

    return {
      previousHeadRevisionId: snapshot.headRevisionId,
      headRevisionId: snapshot.draftRevisionId,
      draftRevisionId: nextDraftRevisionId,
    };
  }

  private async headTableVersion(
    target: TargetTable,
    filesToRegister: RowsWithFiles[],
  ): Promise<string | undefined> {
    const { pair } = target.table;

    switch (target.outcome) {
      case 'absent':
        return undefined;
      case 'unchanged':
      case 'base':
        return this.linkWhole(target, target.linkSide);
      case 'other':
        return this.linkWhole(target, oppositeOf(target.linkSide));
      case 'mixed':
        return this.assembleMixedHeadTable(target, filesToRegister);
      default:
        throw new Error(`Cannot commit table ${pair.createdId}`);
    }
  }

  private async linkWhole(
    target: TargetTable,
    side: 'head' | 'draft',
  ): Promise<string | undefined> {
    const version = sideOf(target.table.pair, side);
    if (version && side === 'draft') {
      await this.versionWriter.lockTableWithRows(
        version.versionId,
        target.table.pair.head?.versionId,
      );
    }
    return version?.versionId;
  }

  private async assembleMixedHeadTable(
    target: TargetTable,
    filesToRegister: RowsWithFiles[],
  ): Promise<string> {
    const source = sideOf(target.table.pair, target.linkSide);
    if (!source) {
      throw new Error(`Table ${target.table.tableId} has no source version`);
    }

    const rows = splitMixedTableRows(target);
    const tableVersionId = await this.versionWriter.createTableVersion({
      source,
      id: target.publicId,
      copyLinksFrom: source.versionId,
      withoutRowVersionIds: rows.dropBaseVersionIds,
      readonly: true,
    });

    const mergedVersionIds = await this.versionWriter.createRowVersions(
      rows.merged,
      true,
    );
    await this.versionWriter.linkRows(tableVersionId, [
      ...rows.linkOtherVersionIds,
      ...mergedVersionIds,
    ]);
    await this.lockPublishedRows(target, tableVersionId, rows);
    filesToRegister.push(...rowsWithFiles(target, mergedVersionIds));
    return tableVersionId;
  }

  private async lockPublishedRows(
    target: TargetTable,
    tableVersionId: string,
    rows: MixedTableRows,
  ): Promise<void> {
    if (target.linkSide === 'head') {
      await this.versionWriter.markRowsReadonly(rows.linkOtherVersionIds);
      return;
    }
    await this.versionWriter.lockRowsOfTable(
      tableVersionId,
      target.table.pair.head?.versionId,
    );
  }

  private async nextDraftTableVersionIds(
    plan: ChangePlan,
    headTables: ReadonlyMap<TargetTable, string>,
  ): Promise<string[]> {
    const versionIds: string[] = [];
    for (const target of plan.target.tables) {
      const versionId = await this.nextDraftTableVersion(
        plan,
        target,
        headTables.get(target),
      );
      if (versionId) {
        versionIds.push(versionId);
      }
    }
    return versionIds;
  }

  private async nextDraftTableVersion(
    plan: ChangePlan,
    target: TargetTable,
    headVersionId: string | undefined,
  ): Promise<string | undefined> {
    const draft = target.table.pair.draft;
    if (!draft) {
      return undefined;
    }
    if (
      target.draftFollowsHead &&
      headVersionId &&
      !(await this.snapshotReader.contentDiffers(
        headVersionId,
        draft.versionId,
      ))
    ) {
      return headVersionId;
    }
    if (
      draft.system &&
      draft.id === SystemTables.Migration &&
      plan.ledger.renumbered.length > 0
    ) {
      return this.renumberedMigrationTable(plan, draft);
    }
    return draft.versionId;
  }

  private async renumberedMigrationTable(
    plan: ChangePlan,
    draftMigrationTable: TableVersion,
  ): Promise<string> {
    const { renumbered } = plan.ledger;
    const tableVersionId = await this.versionWriter.createTableVersion({
      source: draftMigrationTable,
      copyLinksFrom: draftMigrationTable.versionId,
      withoutRowVersionIds: renumbered.map((item) => item.source.versionId),
      readonly: false,
    });

    const versionIds = await this.versionWriter.createRowVersions(
      renumbered.map(({ source, migration }) => ({
        createdId: source.createdId,
        id: migration.id,
        data: migration,
        meta: source.meta,
        hash: objectHash(migration),
        schemaHash: source.schemaHash,
        createdAt: source.createdAt,
        publishedAt: new Date(migration.id),
      })),
      false,
    );
    await this.versionWriter.linkRows(tableVersionId, versionIds);
    return tableVersionId;
  }

  private async retirePreviousHead(revisionId: string): Promise<void> {
    await this.db.revision.update({
      where: { id: revisionId },
      data: { isHead: false, isDraft: false, hasChanges: false },
    });
  }

  private async promoteDraftToHead(
    revisionId: string,
    tableVersionIds: string[],
    comment?: string,
  ): Promise<void> {
    await this.db.revision.update({
      where: { id: revisionId },
      data: {
        isHead: true,
        isDraft: false,
        hasChanges: false,
        comment,
        tables: { set: tableVersionIds.map((versionId) => ({ versionId })) },
      },
    });
  }

  private async createNextDraft(
    plan: ChangePlan,
    tableVersionIds: string[],
  ): Promise<string> {
    const revision = await this.db.revision.create({
      data: {
        id: this.idService.generate(),
        isDraft: true,
        hasChanges: false,
        parent: { connect: { id: plan.snapshot.draftRevisionId } },
        branch: { connect: { id: plan.snapshot.branchId } },
        tables: {
          connect: tableVersionIds.map((versionId) => ({ versionId })),
        },
      },
      select: { id: true },
    });
    return revision.id;
  }

  private async recomputeNextDraftHasChanges(
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
