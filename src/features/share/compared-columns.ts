export const COMPARED_ROW_COLUMNS = [
  'id',
  'hash',
  'schemaHash',
  'publishedAt',
  'meta',
] as const;

export type ComparedRowColumn = (typeof COMPARED_ROW_COLUMNS)[number];

export const ROW_COLUMNS_COMPARED_THROUGH: Readonly<
  Record<string, ComparedRowColumn>
> = { data: 'hash' };

export const NOT_COMPARED_ROW_COLUMNS = [
  'versionId',
  'createdId',
  'readonly',
  'createdAt',
  'updatedAt',
] as const;

export const COMPARED_TABLE_COLUMNS = ['id'] as const;

export const NOT_COMPARED_TABLE_COLUMNS = [
  'versionId',
  'createdId',
  'readonly',
  'system',
  'createdAt',
  'updatedAt',
] as const;
