import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type { CalculateDataCandidatesResult } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import { SystemTables } from 'src/features/share/system-tables.consts';
import { requireCalculated } from './persisted-candidate-scenario';

export function candidateTableNames(
  result: CalculateDataCandidatesResult,
  role: 'head' | 'draft',
  original: DraftChangesSnapshot,
) {
  const state = requireCalculated(result)[role];
  return Object.fromEntries(
    original.head.tables
      .filter(({ system }) => !system)
      .map((table) => [table.id, findTable(state, table.createdId).id]),
  );
}

export function candidateSchemas(
  result: CalculateDataCandidatesResult,
  role: 'head' | 'draft',
  original: DraftChangesSnapshot,
) {
  return schemaIdentities(requireCalculated(result)[role], original);
}

export function candidateProductData(
  result: CalculateDataCandidatesResult,
  role: 'head' | 'draft',
  original: DraftChangesSnapshot,
) {
  const source = original.head.tables.find(({ id }) => id === 'products');
  if (!source) {
    throw new Error('Expected original products table.');
  }
  const product = findTable(
    requireCalculated(result)[role],
    source.createdId,
  ).rows.find(({ id }) => id === 'product');
  if (!product) {
    throw new Error('Expected candidate product row.');
  }
  return product.data;
}

export function originalSchemas(
  original: DraftChangesSnapshot,
  role: 'head' | 'draft',
) {
  return schemaIdentities(original[role], original);
}

function schemaIdentities(
  state: DraftRevisionState,
  original: DraftChangesSnapshot,
) {
  const schemas = state.tables.find(({ id }) => id === SystemTables.Schema);
  return original.head.tables
    .filter(({ system }) => !system)
    .map((table) => {
      const current = findTable(state, table.createdId);
      const schema = schemas?.rows.find(({ id }) => id === current.id);
      if (!schema) {
        throw new Error(`Expected schema for stable table ${table.createdId}.`);
      }
      return {
        tableCreatedId: table.createdId,
        schemaCreatedId: schema.createdId,
        data: schema.data,
        meta: schema.meta,
        hash: schema.hash,
        schemaHash: schema.schemaHash,
      };
    });
}

function findTable(state: DraftRevisionState, createdId: string) {
  const table = state.tables.find(
    (candidate) => candidate.createdId === createdId,
  );
  if (!table) {
    throw new Error(`Expected stable candidate table ${createdId}.`);
  }
  return table;
}
