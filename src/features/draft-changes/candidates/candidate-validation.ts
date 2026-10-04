import objectHash from 'object-hash';
import type { DraftRevisionState } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type { CandidateBlocker } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import { SystemTables } from 'src/features/share/system-tables.consts';
import type { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';

export async function validateCandidateStates(
  head: DraftRevisionState,
  draft: DraftRevisionState,
  validator: JsonSchemaValidatorService,
): Promise<CandidateBlocker[]> {
  const blockers = await validateRole('head', head, validator);
  blockers.push(...(await validateRole('draft', draft, validator)));
  return blockers;
}

async function validateRole(
  role: 'head' | 'draft',
  state: DraftRevisionState,
  validator: JsonSchemaValidatorService,
): Promise<CandidateBlocker[]> {
  const blockers: CandidateBlocker[] = [];
  const tableIds = new Set<string>();
  const tableCreatedIds = new Set<string>();
  for (const table of state.tables) {
    const normalizedId = table.id.toLowerCase();
    if (tableIds.has(normalizedId) || tableCreatedIds.has(table.createdId)) {
      blockers.push({
        code: 'IDENTITY_CONFLICT',
        role,
        tableCreatedId: table.createdId,
        identityScope: 'tableId',
        identityId: table.id,
        message: `Duplicate table identity '${table.id}'.`,
      });
    }
    tableIds.add(normalizedId);
    tableCreatedIds.add(table.createdId);
    blockers.push(...(await validateRows(role, state, table, validator)));
  }
  return blockers;
}

async function validateRows(
  role: 'head' | 'draft',
  state: DraftRevisionState,
  table: DraftRevisionState['tables'][number],
  validator: JsonSchemaValidatorService,
): Promise<CandidateBlocker[]> {
  const blockers: CandidateBlocker[] = [];
  const rowIds = new Set<string>();
  const rowCreatedIds = new Set<string>();
  const schemaTable = state.tables.find(({ id }) => id === SystemTables.Schema);
  const schemaRow = schemaTable?.rows.find(({ id }) => id === table.id);
  const schema = schemaRow?.data;
  const schemaHash = !table.system && schema ? objectHash(schema) : undefined;
  for (const row of table.rows) {
    if (rowIds.has(row.id) || rowCreatedIds.has(row.createdId)) {
      blockers.push({
        code: 'IDENTITY_CONFLICT',
        role,
        tableCreatedId: table.createdId,
        rowCreatedId: row.createdId,
        identityScope: 'rowId',
        identityId: row.id,
        message: `Duplicate row identity '${row.id}'.`,
      });
    }
    rowIds.add(row.id);
    rowCreatedIds.add(row.createdId);
    if (
      !table.system &&
      !(await validRow(validator, row.data, schema, schemaHash))
    ) {
      blockers.push({
        code: 'INVALID_RESULT_DATA',
        role,
        tableCreatedId: table.createdId,
        rowCreatedId: row.createdId,
        message: `Row '${row.id}' does not match its resulting schema.`,
      });
    }
  }
  return blockers;
}

async function validRow(
  validator: JsonSchemaValidatorService,
  data: unknown,
  schema: unknown,
  schemaHash: string | undefined,
): Promise<boolean> {
  if (!schema || typeof schema !== 'object' || !schemaHash) {
    return false;
  }
  const result = await validator.validate(data, schema as never, schemaHash);
  return result.result;
}
