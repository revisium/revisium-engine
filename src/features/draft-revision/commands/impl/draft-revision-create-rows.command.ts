import type { InputJsonValue } from 'src/engine-prisma-types';

export interface DraftRevisionCreateRowsRowData {
  rowId: string;
  data: InputJsonValue;
  schemaHash?: string;
  meta?: InputJsonValue;
  publishedAt?: Date;
}

export interface DraftRevisionCreateRowsCommandData {
  revisionId: string;
  tableId: string;
  rows: DraftRevisionCreateRowsRowData[];
}

export interface DraftRevisionCreatedRowResult {
  rowVersionId: string;
  rowCreatedId: string;
}

export interface DraftRevisionCreateRowsCommandReturnType {
  tableVersionId: string;
  previousTableVersionId: string;
  tableCreatedId: string;
  createdRows: DraftRevisionCreatedRowResult[];
}

export class DraftRevisionCreateRowsCommand {
  constructor(public readonly data: DraftRevisionCreateRowsCommandData) {}
}
