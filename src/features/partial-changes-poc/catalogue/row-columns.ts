import {
  collectSchemaLeaves,
  SchemaLeaf,
} from 'src/features/partial-changes-poc/catalogue/schema-leaves';
import type {
  RowVersion,
  TablePair,
} from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import { sameJson } from 'src/features/partial-changes-poc/structure/same-json';

export type RowColumn = 'publishedAt' | 'meta' | 'schemaHash';

export interface RowColumns {
  createdAt: Date;
  publishedAt: Date;
  meta: unknown;
}

export interface PublishedAtField {
  pointer: string;
  boundToStructure: boolean;
}

export function publishedAtFieldOf(
  pair: TablePair,
): PublishedAtField | undefined {
  if (!pair.draftSchema) {
    return undefined;
  }
  const field = collectSchemaLeaves(pair.draftSchema).find(
    (leaf) => leaf.kind === 'publishedAt',
  );
  if (!field) {
    return undefined;
  }
  return {
    pointer: field.pointer,
    boundToStructure: !isUnchangedLeaf(pair, field),
  };
}

export function comparesSchemaHash(pair: TablePair): boolean {
  return !pair.structure?.differs;
}

export function comparesPublishedAt(pair: TablePair): boolean {
  return !publishedAtFieldOf(pair)?.boundToStructure;
}

export function differingColumns(
  pair: TablePair,
  head: RowVersion,
  draft: RowVersion,
): RowColumn[] {
  const columns: RowColumn[] = [];
  if (!sameInstant(head.publishedAt, draft.publishedAt)) {
    columns.push('publishedAt');
  }
  if (!sameJson(head.meta, draft.meta)) {
    columns.push('meta');
  }
  if (comparesSchemaHash(pair) && head.schemaHash !== draft.schemaHash) {
    columns.push('schemaHash');
  }
  return columns;
}

export function columnsOf(version: RowVersion): RowColumns {
  return {
    createdAt: version.createdAt,
    publishedAt: version.publishedAt,
    meta: version.meta,
  };
}

export function sameColumns(columns: RowColumns, version: RowVersion): boolean {
  return (
    sameInstant(columns.publishedAt, version.publishedAt) &&
    sameJson(columns.meta, version.meta)
  );
}

function isUnchangedLeaf(pair: TablePair, field: SchemaLeaf): boolean {
  if (!pair.structure?.differs) {
    return true;
  }
  return pair.structure.unchangedLeaves.some(
    (leaf) => leaf.pointer === field.pointer,
  );
}

function sameInstant(a: Date | string, b: Date | string): boolean {
  return new Date(a).getTime() === new Date(b).getTime();
}
