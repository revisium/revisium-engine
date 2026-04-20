/**
 * Engine-owned Prisma types.
 *
 * This module decouples the engine from the generated Prisma client so
 * consumers can provide their own PrismaClient while the engine stays
 * schema-independent at the type level.
 *
 * - Model interfaces (`Branch`, `Revision`, `Table`, `Row`) mirror the
 *   Prisma schema fields without depending on code-generation.
 * - Runtime utilities (`Sql`, `sql`, `join`, `raw`, etc.) are re-exported
 *   from `@prisma/client/runtime/client` -- they are schema-independent.
 * - `PrismaClient` and `Prisma` namespace are imported from `@prisma/client`
 *   directly -- the consumer provides this package as a peer dependency.
 */

// ---------------------------------------------------------------------------
// Re-export schema-independent runtime utilities
// ---------------------------------------------------------------------------
export {
  Sql,
  sqltag as sql,
  join,
  raw,
  empty,
} from '@prisma/client/runtime/client';
export type {
  InputJsonValue,
  InputJsonObject,
  JsonValue,
} from '@prisma/client/runtime/client';

import type { JsonValue as _JsonValue } from '@prisma/client/runtime/client';

// ---------------------------------------------------------------------------
// SortOrder & TransactionIsolationLevel
//
// These are generated as strict enums in every Prisma client, but their
// *values* are always the same for PostgreSQL.  We define them here so the
// engine does not pull them from the generated client.
// ---------------------------------------------------------------------------
export const SortOrder = {
  asc: 'asc',
  desc: 'desc',
} as const;

export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder];

export const TransactionIsolationLevel = {
  ReadUncommitted: 'ReadUncommitted',
  ReadCommitted: 'ReadCommitted',
  RepeatableRead: 'RepeatableRead',
  Serializable: 'Serializable',
} as const;

export type TransactionIsolationLevel =
  (typeof TransactionIsolationLevel)[keyof typeof TransactionIsolationLevel];

// ---------------------------------------------------------------------------
// Engine model interfaces — match the Prisma schema field-by-field
// ---------------------------------------------------------------------------
export interface Branch {
  id: string;
  createdAt: Date;
  isRoot: boolean;
  name: string;
  projectId: string;
  [key: string]: unknown;
}

export interface Revision {
  id: string;
  sequence: number;
  createdAt: Date;
  comment: string;
  isHead: boolean;
  isDraft: boolean;
  isStart: boolean;
  hasChanges: boolean;
  branchId: string;
  parentId: string | null;
  [key: string]: unknown;
}

export interface Table {
  versionId: string;
  createdId: string;
  id: string;
  readonly: boolean;
  createdAt: Date;
  updatedAt: Date;
  system: boolean;
  [key: string]: unknown;
}

export interface Row {
  versionId: string;
  createdId: string;
  id: string;
  readonly: boolean;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date;
  data: _JsonValue;
  meta: _JsonValue;
  hash: string;
  schemaHash: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Minimal RowWhereInput — used by SystemColumnMappingService and queries.
//
// Consumers can pass any superset; we only constrain the fields the engine
// actually inspects.
// ---------------------------------------------------------------------------
export interface RowWhereInput {
  AND?: RowWhereInput | RowWhereInput[];
  OR?: RowWhereInput[];
  NOT?: RowWhereInput | RowWhereInput[];
  [key: string]: unknown;
}

export interface TableMigration {
  id: string;
  revisionId: string;
  tableId: string;
  sourceTableVersionId: string;
  shadowTableVersionId: string | null;
  status: string;
  phase: string;
  patches: _JsonValue;
  previousSchema: _JsonValue;
  previousSchemaHash: string;
  targetSchemaHash: string;
  totalRows: number;
  copiedRows: number;
  lastCopiedRowId: string | null;
  batchSize: number;
  currentBatch: number;
  totalBatches: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  lastProgressAt: Date | null;
  lockedBy: string | null;
  lockedAt: Date | null;
  heartbeatAt: Date | null;
  errorMessage: string | null;
  retryCount: number;
  maxRetries: number;
  [key: string]: unknown;
}

export interface FileBlob {
  id: string;
  createdAt: Date;
  projectId: string;
  hash: string;
  size: bigint;
  [key: string]: unknown;
}

export interface ProjectFileUsage {
  projectId: string;
  fileBytes: bigint;
  updatedAt: Date;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// TransactionPrismaClient is re-exported from src/features/share/types.ts
// because it depends on the generated Prisma client for model-specific
// methods.  Consumers who provide their own PrismaClient can extend or
// override that type.
// ---------------------------------------------------------------------------
