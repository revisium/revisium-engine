import type { DraftChangesFingerprintInput } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';

const time = new Date('2025-01-01T00:00:00.000Z');
const SECOND_VALUE = 2;

export function fingerprintSnapshot(): DraftChangesFingerprintInput {
  const row = {
    id: 'product-1',
    createdId: 'row-created',
    versionId: 'row-v1',
    readonly: false,
    createdAt: time,
    updatedAt: time,
    publishedAt: time,
    data: { nested: { value: 'same' }, array: [1, SECOND_VALUE] },
    meta: { labels: ['a', 'b'] },
    hash: 'stored-hash',
    schemaHash: 'schema-hash',
    fileBlobs: [
      {
        id: 'blob-b',
        projectId: 'project',
        hash: 'b',
        size: BigInt(SECOND_VALUE),
        deletedAt: null,
        createdAt: time,
      },
      {
        id: 'blob-a',
        projectId: 'project',
        hash: 'a',
        size: BigInt(1),
        deletedAt: null,
        createdAt: time,
      },
    ],
  };
  const secondRow = {
    ...row,
    id: 'product-2',
    createdId: 'row-created-2',
    versionId: 'row-v2',
  };
  const table = {
    id: 'products',
    createdId: 'table-created',
    versionId: 'table-v1',
    readonly: false,
    createdAt: time,
    updatedAt: time,
    system: false,
    rows: [row, secondRow],
  };
  const secondTable = {
    ...table,
    id: 'archived-products',
    createdId: 'table-created-2',
    versionId: 'table-v2',
    rows: [secondRow],
  };
  return {
    branch: {
      id: 'branch',
      createdAt: time,
      isRoot: true,
      projectId: 'project',
      name: 'main',
    },
    head: {
      id: 'head',
      branchId: 'branch',
      parentId: null,
      sequence: 1,
      createdAt: time,
      comment: '',
      isHead: true,
      isDraft: false,
      isStart: true,
      hasChanges: false,
      tables: [structuredClone(table), structuredClone(secondTable)],
    },
    draft: {
      id: 'draft',
      branchId: 'branch',
      parentId: 'head',
      sequence: 2,
      createdAt: time,
      comment: '',
      isHead: false,
      isDraft: true,
      isStart: false,
      hasChanges: true,
      tables: [table, secondTable],
    },
  };
}

export function firstDraftRow(value: DraftChangesFingerprintInput) {
  const table = value.draft.tables.find(({ id }) => id === 'products');
  const row = table?.rows.find(({ id }) => id === 'product-1');
  if (!table || !row) {
    throw new Error('Expected product table and row in the Draft.');
  }
  return { table, row };
}
