import type { JsonValue } from 'src/engine-prisma-types';

export interface DraftRevisionStateFileBlob {
  id: string;
}

export interface DraftRevisionStateRow {
  id: string;
  createdId: string;
  versionId: string;
  readonly: boolean;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date;
  data: JsonValue;
  meta: JsonValue;
  hash: string;
  schemaHash: string;
  fileBlobs: DraftRevisionStateFileBlob[];
}

export interface DraftRevisionStateTable {
  id: string;
  createdId: string;
  versionId: string;
  readonly: boolean;
  createdAt: Date;
  updatedAt: Date;
  system: boolean;
  rows: DraftRevisionStateRow[];
}

export interface DraftRevisionState {
  tables: DraftRevisionStateTable[];
}

export interface DraftRevisionWriteStateCommandData {
  revisionId: string;
  candidate: DraftRevisionState;
  sources: {
    head: DraftRevisionState;
    others: DraftRevisionState[];
  };
}

export interface DraftRevisionWriteStateCommandResult {
  state: DraftRevisionState;
  createdRowVersionIds: string[];
}

export class DraftRevisionWriteStateCommand {
  constructor(public readonly data: DraftRevisionWriteStateCommandData) {}
}
