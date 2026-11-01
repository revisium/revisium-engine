import { Injectable, NotFoundException } from '@nestjs/common';
import { type Sql, sql } from 'src/engine-prisma-types';
import { TransactionPrismaService } from 'src/infrastructure/database/transaction-prisma.service';
import {
  type BranchPosition,
  cursorOf,
  type ScanRequest,
} from './scan-request';

export interface ScannedBranch extends BranchPosition {
  readonly id: string;
}

export interface BranchPage {
  readonly branches: readonly ScannedBranch[];
  readonly nextCursor: string | null;
}

@Injectable()
export class BranchPageReader {
  constructor(private readonly transactionService: TransactionPrismaService) {}

  private get client() {
    return this.transactionService.getTransactionOrPrisma();
  }

  public async readPage(request: ScanRequest): Promise<BranchPage> {
    await this.ensureRequestedScopeExists(request);
    const branches = await this.client.$queryRaw<ScannedBranch[]>(
      pageSql(request),
    );
    const page = branches.slice(0, request.limit);

    return { branches: page, nextCursor: nextCursorOf(branches, page) };
  }

  private async ensureRequestedScopeExists({
    projectId,
    branchName,
  }: ScanRequest): Promise<void> {
    if (projectId === undefined) {
      return;
    }

    const branch = await this.client.branch.findFirst({
      where: { projectId, name: branchName },
      select: { id: true },
    });

    if (!branch) {
      throw new NotFoundException(
        missingBranchMessageOf(projectId, branchName),
      );
    }
  }
}

function missingBranchMessageOf(
  projectId: string,
  branchName: string | undefined,
): string {
  if (branchName === undefined) {
    return `Project "${projectId}" has no branch`;
  }

  return `Branch "${branchName}" does not exist in project "${projectId}"`;
}

function pageSql({ projectId, branchName, after, limit }: ScanRequest): Sql {
  return sql`
    SELECT "id", "projectId", "name" AS "branchName"
    FROM "Branch"
    WHERE ${projectFilterOf(projectId)}
      AND ${branchFilterOf(branchName)}
      AND ${positionFilterOf(after)}
    ORDER BY "projectId" COLLATE "C", "name" COLLATE "C"
    LIMIT ${limit + 1}
  `;
}

function projectFilterOf(projectId: string | undefined): Sql {
  if (projectId === undefined) {
    return sql`TRUE`;
  }

  return sql`"projectId" = ${projectId}`;
}

function branchFilterOf(branchName: string | undefined): Sql {
  if (branchName === undefined) {
    return sql`TRUE`;
  }

  return sql`"name" = ${branchName}`;
}

function positionFilterOf(after: BranchPosition | undefined): Sql {
  if (!after) {
    return sql`TRUE`;
  }

  return sql`(
    "projectId" COLLATE "C" > ${after.projectId}
    OR ("projectId" = ${after.projectId} AND "name" COLLATE "C" > ${after.branchName})
  )`;
}

function nextCursorOf(
  branches: readonly ScannedBranch[],
  page: readonly ScannedBranch[],
): string | null {
  const last = page.at(-1);

  if (branches.length === page.length || !last) {
    return null;
  }

  return cursorOf(last);
}
