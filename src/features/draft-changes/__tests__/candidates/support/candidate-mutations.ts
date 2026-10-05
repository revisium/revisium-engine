import type { JsonValue } from '@revisium/schema-toolkit/types';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { DraftRevisionStateRow } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type {
  CalculateDataCandidatesQueryData,
  CalculateDataCandidatesResult,
} from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { HistoryPatches } from 'src/features/share/queries/impl/transactional/get-table-schema.query';
import { requireCalculatedCandidate } from 'src/features/draft-changes/__tests__/candidates/support/candidate-results';

export function setCandidateCatalogueFingerprint(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  fingerprint: string,
): void {
  data.catalogue.scope.fingerprint = fingerprint;
}
export function replaceFirstSelectedReference(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
  ref: string,
): void {
  const first = data.selection.selected[0];
  if (!first) {
    throw new Error('Expected at least one selected catalogue entry.');
  }
  data.selection.selected[0] = { ...first, ref: { value: ref } };
}
export function replaceFirstSelectedPayload(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
): void {
  const first = data.selection.selected[0];
  if (!first) {
    throw new Error('Expected at least one selected catalogue entry.');
  }
  data.selection.selected[0] = { ...first, after: 'caller-modified' };
}
export function changeCandidateBranch(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
): void {
  data.snapshot.branch.id = 'different-branch';
}
export function changeCandidateDraftRevision(
  data: Extract<CalculateDataCandidatesQueryData, { mode: 'selected' }>,
): void {
  data.snapshot.draft.id = 'different-draft-revision';
}
export function replaceCandidateRowData(
  result: CalculateDataCandidatesResult,
  role: 'head' | 'draft',
  tableCreatedId: string,
  rowCreatedId: string,
  data: DraftRevisionStateRow['data'],
): void {
  const candidate = requireCalculatedCandidate(result);
  const table = candidate[role].tables.find(
    ({ createdId }) => createdId === tableCreatedId,
  );
  const row = table?.rows.find(({ createdId }) => createdId === rowCreatedId);
  if (!row) {
    throw new Error(`Expected ${role} row '${rowCreatedId}'.`);
  }
  row.data = data;
}
export function mutateCandidateRowContainers(
  result: CalculateDataCandidatesResult,
  role: 'head' | 'draft',
  tableCreatedId: string,
  rowCreatedId: string,
): void {
  const candidate = requireCalculatedCandidate(result);
  const table = candidate[role].tables.find(
    ({ createdId }) => createdId === tableCreatedId,
  );
  const row = table?.rows.find(({ createdId }) => createdId === rowCreatedId);
  if (!row) {
    throw new Error(`Expected ${role} row '${rowCreatedId}'.`);
  }
  const data = row.data as { nested: { value: string } };
  const meta = row.meta as Record<string, JsonValue>;
  data.nested.value = 'candidate-only';
  meta.candidateOnly = true;
  row.fileBlobs.push({ id: 'candidate-only-file' });
}
export function corruptDraftSchemaHistoryHash(
  snapshot: DraftChangesSnapshot,
): void {
  const schemaTable = snapshot.draft.tables.find(
    ({ id }) => id === SystemTables.Schema,
  );
  const schemaRow = schemaTable?.rows[0];
  const history = schemaRow?.meta as unknown as HistoryPatches[] | undefined;
  const firstEntry = history?.[0];
  if (!firstEntry) {
    throw new Error('Expected Draft schema history fixture.');
  }
  firstEntry.hash = 'invalid-history-hash';
}
export function corruptDraftRowHash(
  snapshot: DraftChangesSnapshot,
  tableCreatedId: string,
  rowCreatedId: string,
): void {
  const table = snapshot.draft.tables.find(
    ({ createdId }) => createdId === tableCreatedId,
  );
  const row = table?.rows.find(({ createdId }) => createdId === rowCreatedId);
  if (!row) {
    throw new Error(`Expected Draft row '${rowCreatedId}'.`);
  }
  row.hash = 'invalid-row-hash';
}
