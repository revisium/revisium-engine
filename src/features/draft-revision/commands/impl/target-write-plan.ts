import type { Row } from 'src/engine-prisma-types';

export type RevisionSide = 'head' | 'draft';

export type TableWriteOutcome =
  | 'unchanged'
  | 'absent'
  | 'base'
  | 'other'
  | 'mixed';

export type NewRowVersion = Pick<
  Row,
  | 'createdId'
  | 'createdAt'
  | 'id'
  | 'data'
  | 'hash'
  | 'schemaHash'
  | 'publishedAt'
  | 'meta'
>;

export interface RowLinkChanges {
  readonly removedRowVersionIds: readonly string[];
  readonly addedRowVersionIds: readonly string[];
  readonly newRows: readonly NewRowVersion[];
}

export interface TableWritePlan extends RowLinkChanges {
  readonly identity: string;
  readonly headVersionId?: string;
  readonly draftVersionId?: string;
  readonly outcome: TableWriteOutcome;
  readonly structureSide: RevisionSide;
  readonly relinkCandidate: boolean;
  readonly hasFileFields: boolean;
}

export interface TargetWritePlan {
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly tables: readonly TableWritePlan[];
}

export interface RenumberedRows {
  readonly replacedRowVersionIds: readonly string[];
  readonly newRows: readonly NewRowVersion[];
}

export interface CommitTableWritePlan extends TableWritePlan {
  readonly renumberedRows?: RenumberedRows;
}

export interface CommitTargetWritePlan extends TargetWritePlan {
  readonly branchId: string;
  readonly comment?: string;
  readonly tables: readonly CommitTableWritePlan[];
}

export function versionIdOn(plan: TableWritePlan, side: RevisionSide): string {
  const versionId = side === 'head' ? plan.headVersionId : plan.draftVersionId;

  if (versionId === undefined) {
    throw new Error(`Table ${plan.identity} has no ${side} version`);
  }

  return versionId;
}

export function oppositeOf(side: RevisionSide): RevisionSide {
  if (side === 'head') {
    return 'draft';
  }

  return 'head';
}

export function versionRefsOf(
  versionId: string | undefined,
): { versionId: string }[] {
  if (versionId === undefined) {
    return [];
  }

  return [{ versionId }];
}
