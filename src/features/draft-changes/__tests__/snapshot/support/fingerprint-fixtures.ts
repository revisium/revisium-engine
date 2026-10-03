import type {
  DraftChangesFingerprintInput,
  DraftChangesRevisionSnapshot,
} from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';

type SnapshotTable = DraftChangesFingerprintInput['draft']['tables'][number];
type SnapshotRow = SnapshotTable['rows'][number];
type SnapshotBlob = SnapshotRow['fileBlobs'][number];

const fixtureDate = new Date('2025-01-01T00:00:00.000Z');
const firstArrayValue = 1;
const secondArrayValue = 2;
const firstBlobSize = 1n;
const secondBlobSize = 2n;

function blob(id: string, hash: string, size: bigint): SnapshotBlob {
  return {
    id,
    projectId: 'project',
    hash,
    size,
    deletedAt: null,
    createdAt: fixtureDate,
  };
}

function row(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    id: 'product-1',
    createdId: 'row-created',
    versionId: 'row-v1',
    readonly: false,
    createdAt: fixtureDate,
    updatedAt: fixtureDate,
    publishedAt: fixtureDate,
    data: {
      nested: { value: 'same' },
      array: [firstArrayValue, secondArrayValue],
    },
    meta: { labels: ['a', 'b'] },
    hash: 'stored-hash',
    schemaHash: 'schema-hash',
    fileBlobs: [
      blob('blob-b', 'b', secondBlobSize),
      blob('blob-a', 'a', firstBlobSize),
    ],
    ...overrides,
  };
}

function table(overrides: Partial<SnapshotTable> = {}): SnapshotTable {
  const firstRow = row();
  const secondRow = row({
    id: 'product-2',
    createdId: 'row-created-2',
    versionId: 'row-v2',
  });
  return {
    id: 'products',
    createdId: 'table-created',
    versionId: 'table-v1',
    readonly: false,
    createdAt: fixtureDate,
    updatedAt: fixtureDate,
    system: false,
    rows: [firstRow, secondRow],
    ...overrides,
  };
}

export function fingerprintSnapshot(): DraftChangesFingerprintInput {
  const secondRow = row({
    id: 'product-2',
    createdId: 'row-created-2',
    versionId: 'row-v2',
  });
  const products = table({ rows: [row(), secondRow] });
  const archivedProducts: SnapshotTable = {
    ...products,
    id: 'archived-products',
    createdId: 'table-created-2',
    versionId: 'table-v2',
    rows: [secondRow],
  };
  return {
    branch: {
      id: 'branch',
      createdAt: fixtureDate,
      isRoot: true,
      projectId: 'project',
      name: 'main',
    },
    head: {
      id: 'head',
      branchId: 'branch',
      parentId: null,
      sequence: 1,
      createdAt: fixtureDate,
      comment: '',
      isHead: true,
      isDraft: false,
      isStart: true,
      hasChanges: false,
      tables: [structuredClone(products), structuredClone(archivedProducts)],
    },
    draft: {
      id: 'draft',
      branchId: 'branch',
      parentId: 'head',
      sequence: 2,
      createdAt: fixtureDate,
      comment: '',
      isHead: false,
      isDraft: true,
      isStart: false,
      hasChanges: true,
      tables: [products, archivedProducts],
    },
  };
}

export function requiredTable(
  snapshot: DraftChangesFingerprintInput,
  id = 'products',
): SnapshotTable {
  const found = snapshot.draft.tables.find((table) => table.id === id);
  if (!found) {
    throw new Error(`Expected Draft table '${id}'.`);
  }
  return found;
}

export function requiredRow(
  tableSnapshot: SnapshotTable,
  id = 'product-1',
): SnapshotRow {
  const found = tableSnapshot.rows.find((row) => row.id === id);
  if (!found) {
    throw new Error(`Expected row '${id}' in table '${tableSnapshot.id}'.`);
  }
  return found;
}

export function requiredBlob(
  rowSnapshot: SnapshotRow,
  id: string,
): SnapshotBlob {
  const found = rowSnapshot.fileBlobs.find(
    (blobRecord) => blobRecord.id === id,
  );
  if (!found) {
    throw new Error(`Expected blob '${id}' on row '${rowSnapshot.id}'.`);
  }
  return found;
}

export function requiredRevisionTable(
  revision: DraftChangesRevisionSnapshot,
  id: string,
) {
  const found = revision.tables.find(
    (tableSnapshot) => tableSnapshot.id === id,
  );
  if (!found) {
    throw new Error(`Expected table '${id}' in revision '${revision.id}'.`);
  }
  return found;
}

export function requiredSystemTable(revision: DraftChangesRevisionSnapshot) {
  const found = revision.tables.find(({ system }) => system);
  if (!found) {
    throw new Error(`Expected a system table in revision '${revision.id}'.`);
  }
  return found;
}

export function requiredRevisionRow(
  revision: DraftChangesRevisionSnapshot,
  versionId: string,
) {
  for (const tableSnapshot of revision.tables) {
    const found = tableSnapshot.rows.find(
      (rowSnapshot) => rowSnapshot.versionId === versionId,
    );
    if (found) {
      return found;
    }
  }
  throw new Error(
    `Expected row version '${versionId}' in revision '${revision.id}'.`,
  );
}

export function firstDraftRow(snapshot: DraftChangesFingerprintInput) {
  const tableSnapshot = requiredTable(snapshot);
  return { table: tableSnapshot, row: requiredRow(tableSnapshot) };
}
