import { SystemTables } from 'src/features/share/system-tables.consts';
import type {
  DraftRevisionState,
  DraftRevisionStateRow,
} from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type { CalculateDataCandidatesResult } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import {
  CANDIDATE_ROW_ID,
  PRODUCT_TABLE_ID,
} from 'src/features/draft-changes/__tests__/candidates/support/candidate-scenarios';

export function productData(
  result: CalculateDataCandidatesResult,
  role: 'head' | 'draft',
): DraftRevisionStateRow['data'] {
  return requireCandidateRowData(
    result,
    role,
    PRODUCT_TABLE_ID,
    CANDIDATE_ROW_ID,
  );
}
export function requireCandidateRowData(
  result: CalculateDataCandidatesResult,
  role: 'head' | 'draft',
  tableCreatedId: string,
  rowCreatedId: string,
): DraftRevisionStateRow['data'] {
  const data = candidateRowData(result, role, tableCreatedId, rowCreatedId);
  if (data === undefined) {
    throw new Error(`Expected ${role} row '${rowCreatedId}'.`);
  }
  return data;
}
export function candidateRowData(
  result: CalculateDataCandidatesResult,
  role: 'head' | 'draft',
  tableCreatedId: string,
  rowCreatedId: string,
): DraftRevisionStateRow['data'] | undefined {
  const candidate = requireCalculatedCandidate(result);
  const state: DraftRevisionState = candidate[role];
  const table = state.tables.find(
    ({ createdId }) => createdId === tableCreatedId,
  );
  const row = table?.rows.find(({ createdId }) => createdId === rowCreatedId);
  return row?.data;
}
export function candidateRowIntegrity(
  result: CalculateDataCandidatesResult,
  role: 'head' | 'draft',
  tableCreatedId: string,
  rowCreatedId: string,
): Pick<DraftRevisionStateRow, 'hash' | 'schemaHash' | 'meta' | 'fileBlobs'> {
  const candidate = requireCalculatedCandidate(result);
  const table = candidate[role].tables.find(
    ({ createdId }) => createdId === tableCreatedId,
  );
  const row = table?.rows.find(({ createdId }) => createdId === rowCreatedId);
  if (!row) {
    throw new Error(`Expected ${role} row '${rowCreatedId}'.`);
  }
  return {
    hash: row.hash,
    schemaHash: row.schemaHash,
    meta: row.meta,
    fileBlobs: row.fileBlobs,
  };
}
export function candidateRowReadonly(
  result: CalculateDataCandidatesResult,
  role: 'head' | 'draft',
  tableCreatedId: string,
  rowCreatedId: string,
): boolean {
  const candidate = requireCalculatedCandidate(result);
  const table = candidate[role].tables.find(
    ({ createdId }) => createdId === tableCreatedId,
  );
  const row = table?.rows.find(({ createdId }) => createdId === rowCreatedId);
  if (!row) {
    throw new Error(`Expected ${role} row '${rowCreatedId}'.`);
  }
  return row.readonly;
}
export function candidateRowSnapshot(
  result: CalculateDataCandidatesResult,
  role: 'head' | 'draft',
  tableCreatedId: string,
  rowCreatedId: string,
): Pick<
  DraftRevisionStateRow,
  'data' | 'meta' | 'fileBlobs' | 'hash' | 'schemaHash'
> {
  const candidate = requireCalculatedCandidate(result);
  const table = candidate[role].tables.find(
    ({ createdId }) => createdId === tableCreatedId,
  );
  const row = table?.rows.find(({ createdId }) => createdId === rowCreatedId);
  if (!row) {
    throw new Error(`Expected ${role} row '${rowCreatedId}'.`);
  }
  return {
    data: row.data,
    meta: row.meta,
    fileBlobs: row.fileBlobs,
    hash: row.hash,
    schemaHash: row.schemaHash,
  };
}
export function sourceRowIntegrity(
  snapshot: DraftChangesSnapshot,
  role: 'head' | 'draft',
  tableCreatedId: string,
  rowCreatedId: string,
): Pick<DraftRevisionStateRow, 'hash' | 'schemaHash' | 'meta' | 'fileBlobs'> {
  const table = snapshot[role].tables.find(
    ({ createdId }) => createdId === tableCreatedId,
  );
  const row = table?.rows.find(({ createdId }) => createdId === rowCreatedId);
  if (!row) {
    throw new Error(`Expected source ${role} row '${rowCreatedId}'.`);
  }
  return {
    hash: row.hash,
    schemaHash: row.schemaHash,
    meta: row.meta,
    fileBlobs: row.fileBlobs,
  };
}
export function candidateTableId(
  result: CalculateDataCandidatesResult,
  role: 'head' | 'draft',
  tableCreatedId: string,
): string {
  const candidate = requireCalculatedCandidate(result);
  const table = candidate[role].tables.find(
    ({ createdId }) => createdId === tableCreatedId,
  );
  if (!table) {
    throw new Error(`Expected ${role} table '${tableCreatedId}'.`);
  }
  return table.id;
}
export function candidateTablePresent(
  result: CalculateDataCandidatesResult,
  role: 'head' | 'draft',
  tableCreatedId: string,
): boolean {
  const candidate = requireCalculatedCandidate(result);
  return candidate[role].tables.some(
    ({ createdId }) => createdId === tableCreatedId,
  );
}
export function candidateTableRowIds(
  result: CalculateDataCandidatesResult,
  role: 'head' | 'draft',
  tableCreatedId: string,
): string[] {
  const candidate = requireCalculatedCandidate(result);
  const table = candidate[role].tables.find(
    ({ createdId }) => createdId === tableCreatedId,
  );
  if (!table) {
    throw new Error(`Expected ${role} table '${tableCreatedId}'.`);
  }
  return table.rows.map(({ createdId }) => createdId);
}
export function candidateSchemaRowIdentity(
  result: CalculateDataCandidatesResult,
  role: 'head' | 'draft',
  tableCreatedId: string,
): {
  createdId: string;
  data: DraftRevisionStateRow['data'];
  meta: DraftRevisionStateRow['meta'];
  hash: string;
  schemaHash: string;
} {
  const candidate = requireCalculatedCandidate(result);
  const dataTable = candidate[role].tables.find(
    ({ createdId }) => createdId === tableCreatedId,
  );
  const schemaTable = candidate[role].tables.find(
    ({ id }) => id === SystemTables.Schema,
  );
  const schemaRow = schemaTable?.rows.find(({ id }) => id === dataTable?.id);
  if (!schemaRow) {
    throw new Error(`Expected ${role} schema for table '${tableCreatedId}'.`);
  }
  return {
    createdId: schemaRow.createdId,
    data: schemaRow.data,
    meta: schemaRow.meta,
    hash: schemaRow.hash,
    schemaHash: schemaRow.schemaHash,
  };
}
export function sourceSchemaRowIdentity(
  snapshot: DraftChangesSnapshot,
  role: 'head' | 'draft',
  tableCreatedId: string,
): {
  createdId: string;
  data: DraftRevisionStateRow['data'];
  meta: DraftRevisionStateRow['meta'];
  hash: string;
  schemaHash: string;
} {
  const state = snapshot[role];
  const dataTable = state.tables.find(
    ({ createdId }) => createdId === tableCreatedId,
  );
  const schemaTable = state.tables.find(({ id }) => id === SystemTables.Schema);
  const schemaRow = schemaTable?.rows.find(({ id }) => id === dataTable?.id);
  if (!schemaRow) {
    throw new Error(`Expected source ${role} schema for '${tableCreatedId}'.`);
  }
  return {
    createdId: schemaRow.createdId,
    data: schemaRow.data,
    meta: schemaRow.meta,
    hash: schemaRow.hash,
    schemaHash: schemaRow.schemaHash,
  };
}
export function candidateTableSchema(
  result: CalculateDataCandidatesResult,
  role: 'head' | 'draft',
  tableCreatedId: string,
): DraftRevisionStateRow['data'] {
  const candidate = requireCalculatedCandidate(result);
  const dataTable = candidate[role].tables.find(
    ({ createdId }) => createdId === tableCreatedId,
  );
  const schemaTable = candidate[role].tables.find(
    ({ id }) => id === SystemTables.Schema,
  );
  const schemaRow = schemaTable?.rows.find(({ id }) => id === dataTable?.id);
  if (!schemaRow) {
    throw new Error(`Expected ${role} schema for table '${tableCreatedId}'.`);
  }
  return schemaRow.data;
}
export function candidateRowId(
  result: CalculateDataCandidatesResult,
  role: 'head' | 'draft',
  tableCreatedId: string,
  rowCreatedId: string,
): string {
  const candidate = requireCalculatedCandidate(result);
  const table = candidate[role].tables.find(
    ({ createdId }) => createdId === tableCreatedId,
  );
  const row = table?.rows.find(({ createdId }) => createdId === rowCreatedId);
  if (!row) {
    throw new Error(`Expected ${role} row '${rowCreatedId}'.`);
  }
  return row.id;
}
export function requireCalculatedCandidate(
  result: CalculateDataCandidatesResult,
): Extract<CalculateDataCandidatesResult, { status: 'calculated' }> {
  if (result.status !== 'calculated') {
    throw new Error(
      `Expected calculated candidate, received '${result.status}'.`,
    );
  }
  return result;
}
export function requireCandidateRequirements(
  result: CalculateDataCandidatesResult,
): Extract<CalculateDataCandidatesResult, { status: 'needsEffects' }> {
  if (result.status !== 'needsEffects') {
    throw new Error(`Expected prerequisites, received '${result.status}'.`);
  }
  return result;
}
export function requireCandidateBlocked(
  result: CalculateDataCandidatesResult,
): Extract<CalculateDataCandidatesResult, { status: 'blocked' }> {
  if (result.status !== 'blocked') {
    throw new Error(`Expected blocked candidate, received '${result.status}'.`);
  }
  return result;
}
