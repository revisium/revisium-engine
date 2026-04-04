import type { InputJsonValue } from 'src/engine-prisma-types';

export interface DraftRevisionUpdateRowsRowData {
  rowId: string;
  data: InputJsonValue;
  schemaHash?: string;
  meta?: InputJsonValue;
  publishedAt?: Date;
}

export interface DraftRevisionUpdateRowsCommandData {
  revisionId: string;
  tableId: string;
  rows: DraftRevisionUpdateRowsRowData[];
}

export interface DraftRevisionUpdatedRowResult {
  rowVersionId: string;
  previousRowVersionId: string;
}

export interface DraftRevisionUpdateRowsCommandReturnType {
  tableVersionId: string;
  previousTableVersionId: string;
  updatedRows: DraftRevisionUpdatedRowResult[];
}

export class DraftRevisionUpdateRowsCommand {
  constructor(public readonly data: DraftRevisionUpdateRowsCommandData) {}
}
