import type { Row } from 'src/engine-prisma-types';
import type { SystemTables } from 'src/features/share/system-tables.consts';

export type RevisionSide = 'head' | 'draft';

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

export interface LinkedTableVersion {
  readonly kind: 'linked';
  readonly versionId?: string;
}

export interface MixedTableVersion extends RowLinkChanges {
  readonly kind: 'mixed';
  readonly tableId: string;
  readonly sourceVersionId: string;
  readonly editInPlace: boolean;
  readonly hasFileFields: boolean;
}

export type TargetTableVersion = LinkedTableVersion | MixedTableVersion;

export interface TableWritePlan {
  readonly identity: string;
  readonly headVersionId?: string;
  readonly draftVersionId?: string;
  readonly target: TargetTableVersion;
  readonly relinkCandidate: boolean;
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

export interface DraftRowVersionsReplacement {
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  readonly tableId: SystemTables;
  readonly draftTableVersionId: string;
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
