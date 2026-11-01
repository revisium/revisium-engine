import { Test, TestingModule } from '@nestjs/testing';
import { CommandBus, CqrsModule } from '@nestjs/cqrs';
import { nanoid } from 'nanoid';
import { BranchModule } from 'src/features/branch/branch.module';
import { DRAFT_REVISION_COMMANDS_HANDLERS } from 'src/features/draft-revision/commands/handlers';
import { DraftRevisionApiService } from 'src/features/draft-revision/draft-revision-api.service';
import {
  AssembledVersionWriter,
  CommitTransition,
  DraftRevisionInternalService,
  DraftRevisionValidationService,
  NewRowFileReferences,
} from 'src/features/draft-revision/services';
import { FileUsageModule } from 'src/features/file-usage/file-usage.module';
import { RevisionModule } from 'src/features/revision/revision.module';
import { DiffService } from 'src/features/share/diff.service';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import { DatabaseModule } from 'src/infrastructure/database/database.module';
import { PrismaService } from 'src/infrastructure/database/prisma.service';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';

export interface PrepareDraftRevisionTestResult {
  organizationId: string;
  projectId: string;
  branchId: string;
  headRevisionId: string;
  draftRevisionId: string;
}

export async function prepareDraftRevisionTest(
  prismaService: PrismaService,
): Promise<PrepareDraftRevisionTestResult> {
  const organizationId = `org-${nanoid()}`;
  const projectId = `project-${nanoid()}`;
  const branchId = `branch-${nanoid()}`;
  const headRevisionId = nanoid();
  const draftRevisionId = nanoid();

  await prismaService.branch.create({
    data: {
      id: branchId,
      name: `branch-${branchId}`,
      isRoot: true,
      projectId,
      revisions: {
        create: [
          {
            id: headRevisionId,
            isStart: true,
            isHead: true,
            hasChanges: false,
          },
          {
            id: draftRevisionId,
            parentId: headRevisionId,
            hasChanges: false,
            isDraft: true,
          },
        ],
      },
    },
  });

  return {
    organizationId,
    projectId,
    branchId,
    headRevisionId,
    draftRevisionId,
  };
}

interface GivenCommittedTableWithRowsOptions {
  headRevisionId: string;
  draftRevisionId: string;
  tableId: string;
  rowCount: number;
}

export interface CommittedTableScenario {
  tableVersionId: string;
}

export async function givenCommittedTableWithRows(
  prismaService: PrismaService,
  {
    headRevisionId,
    draftRevisionId,
    tableId,
    rowCount,
  }: GivenCommittedTableWithRowsOptions,
): Promise<CommittedTableScenario> {
  const tableVersionId = nanoid();

  await prismaService.table.create({
    data: {
      versionId: tableVersionId,
      createdId: nanoid(),
      id: tableId,
      readonly: true,
      revisions: {
        connect: [{ id: headRevisionId }, { id: draftRevisionId }],
      },
    },
  });

  await insertCommittedRows(prismaService, tableVersionId, rowCount);

  return { tableVersionId };
}

async function insertCommittedRows(
  prismaService: PrismaService,
  tableVersionId: string,
  rowCount: number,
): Promise<void> {
  await prismaService.$executeRaw`
    WITH committed_rows AS (
      INSERT INTO "Row" ("versionId", "createdId", "id", "readonly", "data", "hash", "schemaHash")
      SELECT gen_random_uuid()::text, gen_random_uuid()::text, 'row-' || n, true, '{}', '', ''
      FROM generate_series(1, ${rowCount}::integer) AS n
      RETURNING "versionId"
    )
    INSERT INTO "_RowToTable" ("A", "B")
    SELECT "versionId", ${tableVersionId}
    FROM committed_rows
  `;
}

export const createDraftRevisionTestingModule = async () => {
  const module: TestingModule = await Test.createTestingModule({
    imports: [
      DatabaseModule,
      CqrsModule,
      RevisionModule,
      BranchModule,
      FileUsageModule,
    ],
    providers: [
      DraftRevisionApiService,
      DraftRevisionInternalService,
      DraftRevisionValidationService,
      AssembledVersionWriter,
      CommitTransition,
      NewRowFileReferences,
      DiffService,
      ShareTransactionalQueries,
      ...DRAFT_REVISION_COMMANDS_HANDLERS,
    ],
  }).compile();

  await module.init();

  return {
    module,
    prismaService: module.get(PrismaService),
    commandBus: module.get(CommandBus),
    transactionService: module.get(TransactionPrismaService),
    draftRevisionApiService: module.get(DraftRevisionApiService),
  };
};
