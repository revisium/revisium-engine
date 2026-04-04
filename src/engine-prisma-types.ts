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
import { Sql, sqltag, join, raw, empty } from '@prisma/client/runtime/client';

import type {
  InputJsonValue,
  InputJsonObject,
  JsonValue,
} from '@prisma/client/runtime/client';

export { Sql, sqltag as sql, join, raw, empty };
export type { InputJsonValue, InputJsonObject, JsonValue };

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
  data: JsonValue;
  meta: JsonValue;
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

// ---------------------------------------------------------------------------
// TransactionPrismaClient is re-exported from src/features/share/types.ts
// because it depends on the generated Prisma client for model-specific
// methods.  Consumers who provide their own PrismaClient can extend or
// override that type.
// ---------------------------------------------------------------------------
