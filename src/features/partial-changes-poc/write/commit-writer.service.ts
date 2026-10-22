import { Injectable } from '@nestjs/common';
import objectHash from 'object-hash';
import { TargetTable } from 'src/features/partial-changes-poc/assembly/target.types';
import { ChangePlan } from 'src/features/partial-changes-poc/planning/change-planner.service';
import {
  oppositeOf,
  sideOf,
  TableVersion,
} from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import { splitMixedTableRows } from 'src/features/partial-changes-poc/write/mixed-table-rows';
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

interface MergedRowsOfTable {
  tableId: string;
  rowVersionIds: string[];
}

@Injectable()
export class CommitWriter {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly idService: IdService,
    private readonly versionWriter: VersionWriter,
    private readonly diffService: DiffService,
    private readonly fileUsageIntegration: FileUsageIntegrationService,
  ) {}

  private get db() {
    return this.transactionService.getTransaction();
  }

  async write(plan: ChangePlan, comment?: string): Promise<CommitWriteResult> {
    const { snapshot } = plan;
    const headTables: string[] = [];
    const mergedRows: MergedRowsOfTable[] = [];

    for (const target of plan.target.tables) {
      const versionId = await this.headTableVersion(target, mergedRows);
      if (versionId) {
        headTables.push(versionId);
      }
    }

    const draftTables = await this.nextDraftTableVersionIds(plan);
    await this.retirePreviousHead(snapshot.headRevisionId);
    await this.promoteDraftToHead(
      snapshot.draftRevisionId,
      headTables,
      comment,
    );
    const nextDraftRevisionId = await this.createNextDraft(plan, draftTables);
    await this.registerFileReferences(snapshot.draftRevisionId, mergedRows);
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
    mergedRows: MergedRowsOfTable[],
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
        return this.assembleMixedHeadTable(target, mergedRows);
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
      await this.versionWriter.lockTableWithRows(version.versionId);
    }
    return version?.versionId;
  }

  private async assembleMixedHeadTable(
    target: TargetTable,
    mergedRows: MergedRowsOfTable[],
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
    await this.versionWriter.lockRowsOfTable(tableVersionId);

    if (!source.system) {
      mergedRows.push({
        tableId: target.publicId ?? source.id,
        rowVersionIds: mergedVersionIds,
      });
    }
    return tableVersionId;
  }

  private async nextDraftTableVersionIds(plan: ChangePlan): Promise<string[]> {
    const versions = plan.snapshot.tables
      .map((pair) => pair.draft)
      .filter((version) => version !== undefined);

    if (plan.ledger.renumbered.length === 0) {
      return versions.map((version) => version.versionId);
    }

    const versionIds: string[] = [];
    for (const version of versions) {
      versionIds.push(
        version.system && version.id === SystemTables.Migration
          ? await this.renumberedMigrationTable(plan, version)
          : version.versionId,
      );
    }
    return versionIds;
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

  private async registerFileReferences(
    revisionId: string,
    mergedRows: MergedRowsOfTable[],
  ): Promise<void> {
    for (const { tableId, rowVersionIds } of mergedRows) {
      await this.fileUsageIntegration.registerReferencesForRowVersions({
        revisionId,
        tableId,
        rowVersionIds,
      });
    }
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
