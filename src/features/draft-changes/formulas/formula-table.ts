import objectHash from 'object-hash';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { DraftRevisionStateTable } from 'src/features/draft-revision/commands/impl/draft-revision-write-state.command';
import type { CandidateFormulaBlocker } from 'src/features/draft-changes/queries/impl/recompute-candidate-formulas.query';
import type { FormulaValidationService } from 'src/features/plugin/formula';
import type { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { formulaPathToSchemaPointer } from './formula-path';

export interface FormulaTableContext {
  role: 'head' | 'draft';
  table: DraftRevisionStateTable;
  schema: JsonSchema;
  resolvedSchema: JsonSchema;
  schemaHash: string;
}

export type FormulaTablePreparation =
  | { status: 'prepared'; context: FormulaTableContext }
  | { status: 'blocked'; blockers: CandidateFormulaBlocker[] };

export function prepareFormulaTable(input: {
  role: 'head' | 'draft';
  table: DraftRevisionStateTable;
  schemaTable: DraftRevisionStateTable | undefined;
  formulaValidation: FormulaValidationService;
  validator: JsonSchemaValidatorService;
}): FormulaTablePreparation {
  const { role, table, schemaTable, formulaValidation, validator } = input;
  const schemaRow = schemaTable?.rows.find(({ id }) => id === table.id);
  if (!schemaRow || !isRecord(schemaRow.data)) {
    return blockedFormulaSchema(role, table.createdId, '');
  }
  const schema = schemaRow.data as JsonSchema;
  const metaValidation = validator.validateMetaSchema(schema);
  if (!metaValidation.result) {
    return {
      status: 'blocked',
      blockers: metaValidation.errors?.map((error) =>
        formulaSchemaBlocker(
          role,
          table.createdId,
          error.instancePath || '',
          error.message ?? 'Schema does not match the engine schema rules.',
        ),
      ) ?? [formulaSchemaBlocker(role, table.createdId, '')],
    };
  }
  const prepared = formulaValidation.prepareSchema(schema);
  if (prepared.status === 'invalidSchema') {
    return blockedFormulaSchema(
      role,
      table.createdId,
      '',
      prepared.error.message,
    );
  }
  if (!prepared.validation.isValid) {
    return {
      status: 'blocked',
      blockers: prepared.validation.errors.map((error) =>
        formulaSchemaBlocker(
          role,
          table.createdId,
          formulaPathToSchemaPointer(error.field),
          error.error,
        ),
      ),
    };
  }
  return {
    status: 'prepared',
    context: {
      role,
      table,
      schema,
      resolvedSchema: prepared.schema,
      schemaHash: objectHash(schema),
    },
  };
}

function blockedFormulaSchema(
  role: 'head' | 'draft',
  tableCreatedId: string,
  path: string,
  message = 'Formula schema is invalid.',
): FormulaTablePreparation {
  return {
    status: 'blocked',
    blockers: [formulaSchemaBlocker(role, tableCreatedId, path, message)],
  };
}

function formulaSchemaBlocker(
  role: 'head' | 'draft',
  tableCreatedId: string,
  path: string,
  message = 'Formula schema is invalid.',
): CandidateFormulaBlocker {
  return {
    code: 'INVALID_FORMULA_SCHEMA',
    role,
    tableCreatedId,
    path,
    message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
