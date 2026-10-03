import { BadRequestException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Prisma } from 'src/__generated__/client';
import {
  DraftRevisionState,
  DraftRevisionStateRow,
  DraftRevisionStateTable,
  DraftRevisionWriteStateCommand,
  DraftRevisionWriteStateCommandResult,
} from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import { DraftRevisionValidationService } from 'src/features/draft-revision/services/draft-revision-validation.service';
import { IdService } from 'src/infrastructure/database/id.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

interface SourceRows {
  byVersion: Map<string, DraftRevisionStateRow>;
  headByCreatedId: Map<string, DraftRevisionStateRow[]>;
  othersByCreatedId: Map<string, DraftRevisionStateRow[]>;
}

interface CandidateTableRows {
  candidate: DraftRevisionStateTable;
  rows: DraftRevisionStateRow[];
  rowVersionIds: string[];
}

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

  async execute({
    data,
  }: DraftRevisionWriteStateCommand): Promise<DraftRevisionWriteStateCommandResult> {
    return this.handle(data);
  }

  private async handle(
    data: DraftRevisionWriteStateCommand['data'],
  ): Promise<DraftRevisionWriteStateCommandResult> {
    await this.validateTargetRevision(data.revisionId);
    this.validateCandidate(data.candidate);

    const sources = this.indexSourceRows(data.sources);
    const { candidateTables, createdRowVersionIds } =
      await this.materializeCandidateRows(data.candidate.tables, sources);
    const stateTables = await this.persistCandidateTables(
      candidateTables,
      data.sources,
    );
    await this.replaceRevisionTables(data.revisionId, stateTables);

    return {
      state: { tables: stateTables },
      createdRowVersionIds: [...new Set(createdRowVersionIds)],
    };
  }

  private async validateTargetRevision(revisionId: string): Promise<void> {
    const revision = await this.transaction.revision.findUnique({
      where: { id: revisionId },
      select: { isDraft: true },
    });
    this.validationService.ensureDraftRevision(revision);
  }

  private indexSourceRows(
    sources: DraftRevisionWriteStateCommand['data']['sources'],
  ): SourceRows {
    const result: SourceRows = {
      byVersion: new Map(),
      headByCreatedId: new Map(),
      othersByCreatedId: new Map(),
    };
    for (const table of sources.head.tables) {
      for (const row of table.rows) {
        result.byVersion.set(row.versionId, row);
        this.addToIndex(result.headByCreatedId, row.createdId, row);
      }
    }
    for (const state of sources.others) {
      for (const table of state.tables) {
        for (const row of table.rows) {
          result.byVersion.set(row.versionId, row);
          this.addToIndex(result.othersByCreatedId, row.createdId, row);
        }
      }
    }
    return result;
  }

  private async materializeCandidateRows(
    tables: DraftRevisionStateTable[],
    sources: SourceRows,
  ): Promise<{
    candidateTables: CandidateTableRows[];
    createdRowVersionIds: string[];
  }> {
    const candidateTables: CandidateTableRows[] = [];
    const createdRowVersionIds: string[] = [];
    for (const candidate of tables) {
      const rows: DraftRevisionStateRow[] = [];
      const rowVersionIds: string[] = [];
      for (const row of candidate.rows) {
        const reusable = this.findReusableRow(row, sources);
        const persisted = reusable ?? (await this.createRow(row));
        rows.push(persisted);
        rowVersionIds.push(persisted.versionId);
        if (!reusable) {
          createdRowVersionIds.push(persisted.versionId);
        }
      }
      candidateTables.push({ candidate, rows, rowVersionIds });
    }
    return { candidateTables, createdRowVersionIds };
  }

  private async persistCandidateTables(
    candidateTables: CandidateTableRows[],
    sources: DraftRevisionWriteStateCommand['data']['sources'],
  ): Promise<DraftRevisionStateTable[]> {
    const headTablesByCreatedId = this.indexTables(sources.head.tables);
    const otherTables = sources.others.flatMap(({ tables }) => tables);
    const otherTablesByCreatedId = this.indexTables(otherTables);
    const tablesByVersion = new Map(
      [...sources.head.tables, ...otherTables].map((table) => [
        table.versionId,
        table,
      ]),
    );
    const result: DraftRevisionStateTable[] = [];
    for (const candidate of candidateTables) {
      const reusable = this.findReusableTable(candidate, {
        head: headTablesByCreatedId.get(candidate.candidate.createdId) ?? [],
        exact: tablesByVersion.get(candidate.candidate.versionId),
        others: otherTablesByCreatedId.get(candidate.candidate.createdId) ?? [],
      });
      result.push(reusable ?? (await this.createTable(candidate)));
    }
    return result;
  }

  private replaceRevisionTables(
    revisionId: string,
    stateTables: DraftRevisionStateTable[],
  ): Promise<unknown> {
    return this.transaction.revision.update({
      where: { id: revisionId },
      data: {
        tables: {
          set: stateTables.map(({ versionId }) => ({ versionId })),
        },
      },
    });
  }

  private async createTable(
    candidate: CandidateTableRows,
  ): Promise<DraftRevisionStateTable> {
    const created = await this.transaction.table.create({
      data: {
        versionId: this.idService.generate(),
        createdId: candidate.candidate.createdId,
        id: candidate.candidate.id,
        readonly: false,
        createdAt: candidate.candidate.createdAt,
        system: candidate.candidate.system,
      },
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
      candidate.rowVersionIds,
    );
    return { ...created, rows: candidate.rows };
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

  private async createRow(
    candidate: DraftRevisionStateRow,
  ): Promise<DraftRevisionStateRow> {
    return this.transaction.row.create({
      data: {
        versionId: this.idService.generate(),
        createdId: candidate.createdId,
        id: candidate.id,
        readonly: false,
        createdAt: candidate.createdAt,
        publishedAt: candidate.publishedAt,
        data:
          candidate.data === null
            ? Prisma.JsonNull
            : (candidate.data as Prisma.InputJsonValue),
        meta:
          candidate.meta === null
            ? Prisma.JsonNull
            : (candidate.meta as Prisma.InputJsonValue),
        hash: candidate.hash,
        schemaHash: candidate.schemaHash,
        fileBlobs: {
          connect: candidate.fileBlobs.map(({ id }) => ({ id })),
        },
      },
      include: { fileBlobs: { select: { id: true } } },
    });
  }

  private validateCandidate(candidate: DraftRevisionState): void {
    const tableIds = new Set<string>();
    const tableCreatedIds = new Set<string>();
    for (const table of candidate.tables) {
      const normalizedId = table.id.toLowerCase();
      if (tableIds.has(normalizedId) || tableCreatedIds.has(table.createdId)) {
        throw new BadRequestException('Candidate table IDs must be unique');
      }
      tableIds.add(normalizedId);
      tableCreatedIds.add(table.createdId);

      const rowIds = new Set<string>();
      const rowCreatedIds = new Set<string>();
      for (const row of table.rows) {
        if (rowIds.has(row.id) || rowCreatedIds.has(row.createdId)) {
          throw new BadRequestException(
            'Candidate row IDs must be unique within each table',
          );
        }
        rowIds.add(row.id);
        rowCreatedIds.add(row.createdId);
      }
    }
  }

  private findReusableRow(
    candidate: DraftRevisionStateRow,
    sources: SourceRows,
  ): DraftRevisionStateRow | undefined {
    return (
      sources.headByCreatedId
        .get(candidate.createdId)
        ?.find((row) => this.sameRow(row, candidate)) ??
      this.exactReusableRow(candidate, sources.byVersion) ??
      sources.othersByCreatedId
        .get(candidate.createdId)
        ?.find((row) => this.sameRow(row, candidate))
    );
  }

  private findReusableTable(
    candidate: CandidateTableRows,
    sources: {
      head: DraftRevisionStateTable[];
      exact: DraftRevisionStateTable | undefined;
      others: DraftRevisionStateTable[];
    },
  ): DraftRevisionStateTable | undefined {
    const { candidate: table, rowVersionIds, rows } = candidate;
    return (
      this.matchingTable(sources.head, table, rowVersionIds, rows) ??
      this.matchingExactTable(sources.exact, table, rowVersionIds, rows) ??
      this.matchingTable(sources.others, table, rowVersionIds, rows)
    );
  }

  private exactReusableRow(
    candidate: DraftRevisionStateRow,
    rowsByVersion: Map<string, DraftRevisionStateRow>,
  ): DraftRevisionStateRow | undefined {
    const exactVersion = rowsByVersion.get(candidate.versionId);
    return exactVersion && this.sameRow(exactVersion, candidate)
      ? exactVersion
      : undefined;
  }

  private matchingTable(
    tables: DraftRevisionStateTable[],
    candidate: DraftRevisionStateTable,
    rowVersionIds: string[],
    rows: DraftRevisionStateRow[],
  ): DraftRevisionStateTable | undefined {
    const match = tables.find((table) =>
      this.sameTable(table, candidate, rowVersionIds),
    );
    return match ? { ...match, rows } : undefined;
  }

  private matchingExactTable(
    exact: DraftRevisionStateTable | undefined,
    candidate: DraftRevisionStateTable,
    rowVersionIds: string[],
    rows: DraftRevisionStateRow[],
  ): DraftRevisionStateTable | undefined {
    if (!exact || !this.sameTable(exact, candidate, rowVersionIds)) {
      return undefined;
    }
    return { ...exact, rows };
  }

  private indexTables(
    tables: DraftRevisionStateTable[],
  ): Map<string, DraftRevisionStateTable[]> {
    const result = new Map<string, DraftRevisionStateTable[]>();
    for (const table of tables) {
      this.addToIndex(result, table.createdId, table);
    }
    return result;
  }

  private addToIndex<T>(map: Map<string, T[]>, key: string, value: T): void {
    const entries = map.get(key) ?? [];
    entries.push(value);
    map.set(key, entries);
  }

  private sameRow(
    left: DraftRevisionStateRow,
    right: DraftRevisionStateRow,
  ): boolean {
    return (
      left.id === right.id &&
      left.createdId === right.createdId &&
      left.createdAt.getTime() === right.createdAt.getTime() &&
      left.publishedAt.getTime() === right.publishedAt.getTime() &&
      left.hash === right.hash &&
      left.schemaHash === right.schemaHash &&
      this.sameJson(left.data, right.data) &&
      this.sameJson(left.meta, right.meta) &&
      this.sameStringSet(
        left.fileBlobs.map(({ id }) => id),
        right.fileBlobs.map(({ id }) => id),
      )
    );
  }

  private sameTable(
    left: DraftRevisionStateTable,
    right: DraftRevisionStateTable,
    rowVersionIds: string[],
  ): boolean {
    return (
      left.id === right.id &&
      left.createdId === right.createdId &&
      left.createdAt.getTime() === right.createdAt.getTime() &&
      left.system === right.system &&
      this.sameStringSet(
        left.rows.map(({ versionId }) => versionId),
        rowVersionIds,
      )
    );
  }

  private sameStringSet(left: string[], right: string[]): boolean {
    const leftSet = new Set(left);
    const rightSet = new Set(right);
    return (
      leftSet.size === rightSet.size &&
      [...leftSet].every((value) => rightSet.has(value))
    );
  }

  private sameJson(left: unknown, right: unknown): boolean {
    if (left === right) {
      return true;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
      return (
        Array.isArray(left) &&
        Array.isArray(right) &&
        left.length === right.length &&
        left.every((value, index) => this.sameJson(value, right[index]))
      );
    }
    if (
      typeof left !== 'object' ||
      left === null ||
      typeof right !== 'object' ||
      right === null
    ) {
      return false;
    }

    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    return leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        this.sameJson(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
        ),
    );
  }
}
