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
