import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Prisma } from 'src/__generated__/client';
import {
  DraftRevisionStateRow,
  DraftRevisionStateTable,
  DraftRevisionWriteStateCommand,
  DraftRevisionWriteStateCommandResult,
} from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import { DraftRevisionValidationService } from 'src/features/draft-revision/services/draft-revision-validation.service';
import { SourceVersions } from 'src/features/draft-revision/state/source-versions';
import {
  toRowCreateInput,
  toTableCreateInput,
} from 'src/features/draft-revision/state/persistence-inputs';
import { IdService } from 'src/infrastructure/database/id.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

@CommandHandler(DraftRevisionWriteStateCommand)
export class DraftRevisionWriteStateHandler implements ICommandHandler<DraftRevisionWriteStateCommand> {
  constructor(
    private readonly transactionService: TransactionPrismaService,
    private readonly validationService: DraftRevisionValidationService,
    private readonly idService: IdService,
  ) {}

  private get transaction() {
    return this.transactionService.getTransaction();
  }

  execute({
    data,
  }: DraftRevisionWriteStateCommand): Promise<DraftRevisionWriteStateCommandResult> {
    return this.handle(data);
  }

  private async handle(
    data: DraftRevisionWriteStateCommand['data'],
  ): Promise<DraftRevisionWriteStateCommandResult> {
    await this.validateTargetRevision(data.revisionId);
    this.validationService.ensureUniqueCandidateIds(data.candidate);

    const sources = new SourceVersions(data.sources.head, data.sources.others);
    const written = await this.writeTables(data.candidate.tables, sources);
    await this.replaceRevisionTables(data.revisionId, written.tables);

    return {
      state: { tables: written.tables },
      createdRowVersionIds: [...new Set(written.createdRowVersionIds)],
    };
  }

  private async validateTargetRevision(revisionId: string): Promise<void> {
    const revision = await this.transaction.revision.findUnique({
      where: { id: revisionId },
      select: { isDraft: true },
    });
    this.validationService.ensureDraftRevision(revision);
  }

  private async writeTables(
    candidates: DraftRevisionStateTable[],
    sources: SourceVersions,
  ): Promise<{
    tables: DraftRevisionStateTable[];
    createdRowVersionIds: string[];
  }> {
    const tables: DraftRevisionStateTable[] = [];
    const createdRowVersionIds: string[] = [];
    for (const candidate of candidates) {
      const written = await this.writeTable(candidate, sources);
      tables.push(written.table);
      createdRowVersionIds.push(...written.createdRowVersionIds);
    }
    return { tables, createdRowVersionIds };
  }

  private async writeTable(
    candidate: DraftRevisionStateTable,
    sources: SourceVersions,
  ): Promise<{
    table: DraftRevisionStateTable;
    createdRowVersionIds: string[];
  }> {
    const writtenRows = await this.writeRows(candidate.rows, sources);
    const reusable = sources.findReusableTable(candidate, writtenRows.rows);
    let table: DraftRevisionStateTable;
    if (reusable) {
      table = reusable;
    } else {
      table = await this.createTable(candidate, writtenRows.rows);
    }
    return { table, createdRowVersionIds: writtenRows.createdRowVersionIds };
  }

  private async writeRows(
    candidates: DraftRevisionStateRow[],
    sources: SourceVersions,
  ): Promise<{
    rows: DraftRevisionStateRow[];
    createdRowVersionIds: string[];
  }> {
    const rows: DraftRevisionStateRow[] = [];
    const createdRowVersionIds: string[] = [];
    for (const candidate of candidates) {
      const written = await this.writeRow(candidate, sources);
      rows.push(written.row);
      if (written.created) {
        createdRowVersionIds.push(written.row.versionId);
      }
    }
    return { rows, createdRowVersionIds };
  }

  private async writeRow(
    candidate: DraftRevisionStateRow,
    sources: SourceVersions,
  ): Promise<{ row: DraftRevisionStateRow; created: boolean }> {
    const reusable = sources.findReusableRow(candidate);
    if (reusable) {
      return { row: reusable, created: false };
    }
    const row = await this.createRow(candidate);
    return { row, created: true };
  }

  private async createTable(
    candidate: DraftRevisionStateTable,
    rows: DraftRevisionStateRow[],
  ): Promise<DraftRevisionStateTable> {
    const created = await this.transaction.table.create({
      data: toTableCreateInput(candidate, this.idService.generate()),
      select: {
        versionId: true,
        createdAt: true,
        updatedAt: true,
        createdId: true,
        id: true,
        readonly: true,
        system: true,
      },
    });
    await this.associateRowsWithTable(
      created.versionId,
      rows.map(({ versionId }) => versionId),
    );
    return { ...created, rows };
  }

  private async associateRowsWithTable(
    tableVersionId: string,
    rowVersionIds: string[],
  ): Promise<void> {
    if (rowVersionIds.length === 0) {
      return;
    }
    await this.transaction.$executeRaw(
      Prisma.sql`
        INSERT INTO "_RowToTable" ("A", "B")
        SELECT row_version."versionId", ${tableVersionId}
        FROM unnest(${rowVersionIds}::text[]) AS row_version("versionId")
        ON CONFLICT ("A", "B") DO NOTHING
      `,
    );
  }

  private createRow(
    candidate: DraftRevisionStateRow,
  ): Promise<DraftRevisionStateRow> {
    return this.transaction.row.create({
      data: toRowCreateInput(candidate, this.idService.generate()),
      include: { fileBlobs: { select: { id: true } } },
    });
  }

  private replaceRevisionTables(
    revisionId: string,
    tables: DraftRevisionStateTable[],
  ): Promise<unknown> {
    return this.transaction.revision.update({
      where: { id: revisionId },
      data: { tables: { set: tables.map(({ versionId }) => ({ versionId })) } },
    });
  }
}
