import objectHash from 'object-hash';
import type { CalculateDataCandidatesResult } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import { SystemTables } from 'src/features/share/system-tables.consts';

export function productStates(result: CalculateDataCandidatesResult) {
  const calculated = requireCalculated(result);
  return {
    head: findStateRow(calculated.head, 'products', 'product').data,
    draft: findStateRow(calculated.draft, 'products', 'product').data,
  };
}

export function createdRowSchemaHashes(result: CalculateDataCandidatesResult) {
  const calculated = requireCalculated(result);
  const hashes = (role: 'head' | 'draft') => ({
    actual: findStateRow(calculated[role], 'products', 'new').schemaHash,
    expected: objectHash(
      findStateRow(calculated[role], SystemTables.Schema, 'products').data,
    ),
  });
  return { head: hashes('head'), draft: hashes('draft') };
}

export function createdTableRowSchemaHashes(
  result: CalculateDataCandidatesResult,
) {
  const head = requireCalculated(result).head;
  return {
    actual: findStateRow(head, 'new-products', 'new').schemaHash,
    expected: objectHash(
      findStateRow(head, SystemTables.Schema, 'new-products').data,
    ),
  };
}

export function restoredProductHash(result: CalculateDataCandidatesResult) {
  return findStateRow(requireCalculated(result).draft, 'products', 'product')
    .hash;
}

export function restoredProductMetadata(result: CalculateDataCandidatesResult) {
  const draft = requireCalculated(result).draft;
  const row = findStateRow(draft, 'products', 'product');
  const schema = findStateRow(draft, SystemTables.Schema, 'products');
  return {
    hash: row.hash,
    expectedHash: objectHash(row.data),
    schemaHash: row.schemaHash,
    expectedSchemaHash: objectHash(schema.data),
    readonly: row.readonly,
  };
}

export function restoredSchemaHistory(result: CalculateDataCandidatesResult) {
  return findStateRow(
    requireCalculated(result).draft,
    SystemTables.Schema,
    'products',
  ).meta;
}

export function candidateSchemaHash(
  result: CalculateDataCandidatesResult,
  role: 'head' | 'draft',
) {
  return findStateRow(
    requireCalculated(result)[role],
    SystemTables.Schema,
    'products',
  ).schemaHash;
}

export function sourceSchemaHash(snapshot: DraftChangesSnapshot) {
  return findStateRow(snapshot.head, SystemTables.Schema, 'products')
    .schemaHash;
}

export function candidateTableRows(
  result: CalculateDataCandidatesResult,
  role: 'head' | 'draft',
  tableId: string,
) {
  const table = requireCalculated(result)[role].tables.find(
    ({ id }) => id === tableId,
  );
  if (!table) {
    throw new Error(`Expected candidate table '${tableId}'.`);
  }
  return table.rows;
}

export function requireCalculated(result: CalculateDataCandidatesResult) {
  if (result.status !== 'calculated') {
    throw new Error(
      `Expected calculated candidates: ${JSON.stringify(result)}`,
    );
  }
  return result;
}

export function findStateRow(
  state: DraftRevisionState,
  tableId: string,
  rowId: string,
) {
  const row = state.tables
    .find(({ id }) => id === tableId)
    ?.rows.find(({ id }) => id === rowId);
  if (!row) {
    throw new Error(`Expected persisted fixture row '${tableId}/${rowId}'.`);
  }
  return row;
}
