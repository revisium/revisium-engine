import { Injectable } from '@nestjs/common';
import {
  validateSchemaFormulas,
  type SchemaValidationResult,
} from '@revisium/schema-toolkit/formula';
import { JsonSchema } from '@revisium/schema-toolkit/types';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';

type InputJsonSchema = JsonSchema | Record<string, unknown>;

export type PreparedFormulaSchema =
  | {
      status: 'prepared';
      schema: JsonSchema;
      validation: SchemaValidationResult;
    }
  | { status: 'invalidSchema'; error: Error };

@Injectable()
export class FormulaValidationService {
  constructor(
    private readonly jsonSchemaStoreService: JsonSchemaStoreService,
  ) {}

  public validateSchema(schema: InputJsonSchema): SchemaValidationResult {
    const prepared = this.prepareSchema(schema);
    if (prepared.status === 'invalidSchema') {
      throw prepared.error;
    }
    return prepared.validation;
  }

  public prepareSchema(schema: InputJsonSchema): PreparedFormulaSchema {
    let resolvedSchema: JsonSchema;
    try {
      resolvedSchema = this.jsonSchemaStoreService
        .create(schema as JsonSchema)
        .getPlainSchema();
    } catch (error) {
      if (isKnownSchemaInputError(error)) {
        return { status: 'invalidSchema', error };
      }
      throw error;
    }

    return {
      status: 'prepared',
      schema: resolvedSchema,
      validation: validateSchemaFormulas(
        resolvedSchema as Record<string, unknown>,
      ),
    };
  }
}

function isKnownSchemaInputError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (/^Not found schema for \$ref="[\s\S]*"$/.test(error.message) ||
      /^Not found required field "[\s\S]*" in "properties"$/.test(
        error.message,
      ))
  );
}
