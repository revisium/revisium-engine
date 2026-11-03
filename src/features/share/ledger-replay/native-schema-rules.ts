import { validateSchemaFormulas } from '@revisium/schema-toolkit/formula';
import {
  applyAddPatch,
  applyMovePatch,
  applyRemovePatch,
  applyReplacePatch,
  createJsonSchemaStore,
  getForeignKeyPatchesFromSchema,
  getForeignKeysFromSchema,
  getInvalidFieldNamesInSchema,
  SchemaTable,
} from '@revisium/schema-toolkit/lib';
import type {
  JsonObjectStore,
  JsonSchemaStore,
} from '@revisium/schema-toolkit/model';
import {
  type JsonPatch,
  type JsonSchema,
  JsonSchemaTypeName,
} from '@revisium/schema-toolkit/types';
import { formatFormulaValidationMessage } from 'src/features/share/exceptions/formula-validation-message';
import { invalidFieldNamesMessage } from 'src/features/share/utils/validateUrlLikeId/validateJsonFieldName';

export type SchemaRefs = Readonly<Record<string, JsonSchema>>;

export interface ValidationOutcome {
  result: boolean;
  errors?: readonly { instancePath: string; message?: string }[] | null;
}

export interface SchemaValidator {
  validateMetaSchema(data: unknown): ValidationOutcome;
  validateJsonPatchSchema(data: unknown): ValidationOutcome;
}

export class NativeSchemaRules {
  constructor(
    private readonly refs: SchemaRefs,
    private readonly validator: SchemaValidator,
  ) {}

  public foreignKeysOf(schema: JsonSchema): string[] {
    return getForeignKeysFromSchema(createJsonSchemaStore(schema, this.refs));
  }

  public patchedSchema(schema: JsonSchema, patches: JsonPatch[]): JsonSchema {
    const schemaTable = new SchemaTable(schema, this.refs);
    schemaTable.applyPatches(patches);

    return schemaTable.getSchema();
  }

  public schemaStore(schema: JsonSchema): NativeSchemaStore {
    return new NativeSchemaStore(schema, this.refs);
  }

  public renamedForeignKeys(
    schema: JsonSchema,
    tableId: string,
    nextTableId: string,
  ): JsonSchema {
    const patches = getForeignKeyPatchesFromSchema(
      createJsonSchemaStore(schema, this.refs),
      { tableId, nextTableId },
    );
    const renamed = this.patchedSchema(schema, patches);
    this.ensureRecordableChange(renamed, patches);

    return renamed;
  }

  public ensureValidPatches(patches: JsonPatch[]): void {
    if (patches.length < 1) {
      throw new Error('Invalid length of patches');
    }

    const outcome = this.validator.validateJsonPatchSchema(patches);
    if (!outcome.result) {
      throw new Error(`patches is not valid: ${detailsOf(outcome)}`);
    }
  }

  public ensureValidSchema(schema: JsonSchema): void {
    const outcome = this.validator.validateMetaSchema(schema);
    if (!outcome.result) {
      throw new Error(`schema is not valid: ${detailsOf(outcome)}`);
    }

    const formulas = validateSchemaFormulas(
      createJsonSchemaStore(schema, this.refs).getPlainSchema() as Record<
        string,
        unknown
      >,
    );
    if (!formulas.isValid) {
      throw new Error(formatFormulaValidationMessage(formulas.errors));
    }
  }

  public ensureValidFieldNames(schemas: JsonSchema[]): void {
    for (const schema of schemas) {
      const invalidFields = getInvalidFieldNamesInSchema(schema, this.refs);

      if (invalidFields.length > 0) {
        throw new Error(
          invalidFieldNamesMessage(invalidFields.map(({ name }) => name)),
        );
      }
    }
  }

  public ensureRecordableChange(schema: JsonSchema, patches: JsonPatch[]) {
    if (!this.validator.validateMetaSchema(schema).result) {
      throw new Error('data is not valid');
    }

    if (!this.validator.validateJsonPatchSchema(patches).result) {
      throw new Error('patches is not valid');
    }

    this.ensureValidFieldNames(patchValues(patches));
  }
}

export class NativeSchemaStore {
  private root: JsonSchemaStore;

  constructor(
    schema: JsonSchema,
    private readonly refs: SchemaRefs,
  ) {
    this.root = createJsonSchemaStore(schema, refs);
  }

  public applyPatch(patch: JsonPatch): void {
    switch (patch.op) {
      case 'add':
        applyAddPatch(this.root, patch, this.refs);
        return;
      case 'move':
        applyMovePatch(this.root, patch);
        return;
      case 'remove':
        applyRemovePatch(this.root, patch);
        return;
      case 'replace':
        this.root = applyReplacePatch(this.root, patch, this.refs);
        return;
    }
  }

  public hasObjectSchemaAt(fieldPath: readonly string[]): boolean {
    return isObjectSchema(
      fieldPath.reduce<JsonSchemaStore | undefined>(propertyOf, this.root),
    );
  }

  public schema(): JsonSchema {
    return this.root.getPlainSchema();
  }
}

export function patchValues(patches: JsonPatch[]): JsonSchema[] {
  return patches.flatMap((patch) =>
    patch.op === 'add' || patch.op === 'replace' ? [patch.value] : [],
  );
}

function detailsOf({ errors }: ValidationOutcome): string {
  return (errors ?? [])
    .map(
      ({ instancePath, message }) =>
        `${instancePath} ${message ?? '<no message>'}`,
    )
    .join('; ');
}

function propertyOf(
  node: JsonSchemaStore | undefined,
  name: string,
): JsonSchemaStore | undefined {
  if (!isObjectSchema(node)) {
    return undefined;
  }

  return node.getProperty(name);
}

function isObjectSchema(
  node: JsonSchemaStore | undefined,
): node is JsonObjectStore {
  return node?.type === JsonSchemaTypeName.Object && !node.$ref;
}
