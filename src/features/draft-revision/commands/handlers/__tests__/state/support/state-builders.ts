import { nanoid } from 'nanoid';
import type {
  DraftRevisionState,
  DraftRevisionStateRow,
  DraftRevisionStateTable,
} from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';

export function row(
  overrides: Partial<DraftRevisionStateRow> = {},
): DraftRevisionStateRow {
  const createdAt = new Date('2025-01-01T00:00:00.000Z');
  return {
    id: 'product-1',
    createdId: nanoid(),
    versionId: nanoid(),
    readonly: false,
    createdAt,
    updatedAt: createdAt,
    publishedAt: new Date('2025-02-01T00:00:00.000Z'),
    data: { title: 'Original' },
    meta: {},
    hash: 'data-hash',
    schemaHash: 'schema-hash',
    fileBlobs: [],
    ...overrides,
  };
}

export function table(
  overrides: Partial<DraftRevisionStateTable> = {},
): DraftRevisionStateTable {
  const createdAt = new Date('2025-01-01T00:00:00.000Z');
  return {
    id: 'products',
    createdId: nanoid(),
    versionId: nanoid(),
    readonly: false,
    createdAt,
    updatedAt: createdAt,
    system: false,
    rows: [],
    ...overrides,
  };
}

export function candidateFrom(state: DraftRevisionState): DraftRevisionState {
  return structuredClone(state);
}

export function requireTable(
  state: DraftRevisionState,
  index = 0,
): DraftRevisionStateTable {
  const found = state.tables[index];
  if (!found) {
    throw new Error(`Missing table at index ${index}`);
  }
  return found;
}

export function requireRow(
  tableState: DraftRevisionStateTable,
  index = 0,
): DraftRevisionStateRow {
  const found = tableState.rows[index];
  if (!found) {
    throw new Error(`Missing row at index ${index}`);
  }
  return found;
}
