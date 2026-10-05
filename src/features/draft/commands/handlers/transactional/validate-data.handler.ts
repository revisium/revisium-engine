import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { JsonSchema, JsonValue } from '@revisium/schema-toolkit/types';
import { ErrorObject } from 'ajv/dist/2020';
import {
  ValidateDataCommand,
  ValidateDataCommandReturnType,
} from 'src/features/draft/commands/impl/transactional/validate-data.command';
import {
  DataValidationException,
  ForeignKeyErrorDetail,
  ForeignKeyRowsNotFoundException,
  ForeignKeyTableNotFoundException,
  ValidationErrorDetail,
} from 'src/features/share/exceptions';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import { ShareTransactionalQueries } from 'src/features/share/share.transactional.queries';
import {
  ForeignKeyReference,
  getForeignKeyReferences,
} from 'src/features/share/foreign-key-references';

interface RowData {
  rowId: string;
  data: unknown;
}

@CommandHandler(ValidateDataCommand)
export class ValidateDataHandler implements ICommandHandler<
  ValidateDataCommand,
  ValidateDataCommandReturnType
> {
  constructor(
    protected readonly shareTransactionalQueries: ShareTransactionalQueries,
    protected readonly jsonSchemaValidator: JsonSchemaValidatorService,
    protected readonly jsonSchemaStore: JsonSchemaStoreService,
  ) {}

  async execute({ data }: ValidateDataCommand) {
    const schema = data.tableSchema || (await this.getSchema(data));
    const schemaHash = this.jsonSchemaValidator.getSchemaHash(schema);

    await this.validateRowsAgainstSchema(
      data.rows,
      schema,
      schemaHash,
      data.tableId,
    );
    await this.validateForeignKeyReferences(
      data.rows,
      schema,
      data.tableId,
      data.revisionId,
    );

    return { schemaHash };
  }

  private async validateRowsAgainstSchema(
    rows: RowData[],
    schema: JsonSchema,
    schemaHash: string,
    tableId: string,
  ): Promise<void> {
    for (const row of rows) {
      const { result, errors } = await this.jsonSchemaValidator.validate(
        row.data,
        schema,
        schemaHash,
      );

      if (!result) {
        throw new DataValidationException(
          this.formatValidationErrors(errors || []),
          { tableId, rowId: row.rowId },
        );
      }
    }
  }

  private async validateForeignKeyReferences(
    rows: RowData[],
    schema: JsonSchema,
    tableId: string,
    revisionId: string,
  ): Promise<void> {
    const allErrors: ForeignKeyErrorDetail[] = [];

    for (const row of rows) {
      const foreignKeys = this.extractForeignKeyReferences(row, schema);
      const errors = await this.checkForeignKeyReferences(
        foreignKeys,
        tableId,
        revisionId,
      );
      allErrors.push(...errors);
    }

    if (allErrors.length > 0) {
      throw new ForeignKeyRowsNotFoundException(allErrors, { tableId });
    }
  }

  private extractForeignKeyReferences(
    row: RowData,
    schema: JsonSchema,
  ): ForeignKeyReference[] {
    const schemaStore = this.jsonSchemaStore.create(schema);
    return getForeignKeyReferences(schemaStore, row.data as JsonValue);
  }

  private async checkForeignKeyReferences(
    foreignKeys: ForeignKeyReference[],
    tableId: string,
    revisionId: string,
  ): Promise<ForeignKeyErrorDetail[]> {
    if (foreignKeys.length === 0) {
      return [];
    }

    const groupedByTable = this.groupForeignKeysByTable(foreignKeys);
    return this.validateGroupedForeignKeys(groupedByTable, tableId, revisionId);
  }

  private formatValidationErrors(
    errors: ErrorObject[],
  ): ValidationErrorDetail[] {
    return errors.map((error) => ({
      path: error.instancePath || '/',
      message: this.formatValidationMessage(error),
    }));
  }

  private formatValidationMessage(error: ErrorObject): string {
    const { keyword, params, message } = error;

    const messageFormatters: Record<string, () => string> = {
      type: () => `must be ${params?.type}`,
      required: () => `missing required property "${params?.missingProperty}"`,
      additionalProperties: () =>
        `has unknown property "${params?.additionalProperty}"`,
      enum: () => `must be one of: ${params?.allowedValues?.join(', ')}`,
      minimum: () => `must be >= ${params?.limit}`,
      maximum: () => `must be <= ${params?.limit}`,
      minLength: () => `must have at least ${params?.limit} characters`,
      maxLength: () => `must have at most ${params?.limit} characters`,
      pattern: () => `must match pattern "${params?.pattern}"`,
      format: () => `must be a valid ${params?.format}`,
    };

    return messageFormatters[keyword]?.() || message || 'validation failed';
  }

  private async getSchema(
    data: ValidateDataCommand['data'],
  ): Promise<JsonSchema> {
    const result = await this.shareTransactionalQueries.getTableSchema(
      data.revisionId,
      data.tableId,
    );
    return result.schema;
  }

  private groupForeignKeysByTable(
    foreignKeys: ForeignKeyReference[],
  ): Map<string, Array<{ rowId: string; path: string }>> {
    const grouped = new Map<string, Array<{ rowId: string; path: string }>>();

    for (const fk of foreignKeys) {
      const existing = grouped.get(fk.tableId) || [];
      existing.push({ rowId: fk.rowId, path: fk.legacyPath });
      grouped.set(fk.tableId, existing);
    }

    return grouped;
  }

  private async validateGroupedForeignKeys(
    groupedByTable: Map<string, Array<{ rowId: string; path: string }>>,
    tableId: string,
    revisionId: string,
  ): Promise<ForeignKeyErrorDetail[]> {
    const results = await Promise.all(
      Array.from(groupedByTable.entries()).map(([refTableId, items]) =>
        this.validateTableReferences(refTableId, items, tableId, revisionId),
      ),
    );

    return results.flat();
  }

  private async validateTableReferences(
    refTableId: string,
    references: Array<{ rowId: string; path: string }>,
    sourceTableId: string,
    revisionId: string,
  ): Promise<ForeignKeyErrorDetail[]> {
    const table = await this.shareTransactionalQueries.findTableInRevision(
      revisionId,
      refTableId,
    );

    if (!table) {
      throw new ForeignKeyTableNotFoundException(
        refTableId,
        { tableId: sourceTableId },
        references[0]?.path ?? '',
      );
    }

    return this.findMissingRows(table.versionId, refTableId, references);
  }

  private async findMissingRows(
    tableVersionId: string,
    tableId: string,
    references: Array<{ rowId: string; path: string }>,
  ): Promise<ForeignKeyErrorDetail[]> {
    const rowIds = references.map((ref) => ref.rowId);
    const existingRows = await this.shareTransactionalQueries.findRowsInTable(
      tableVersionId,
      rowIds,
    );

    const existingRowIds = new Set(existingRows.map((row) => row.id));

    return references
      .filter((ref) => !existingRowIds.has(ref.rowId))
      .map((ref) => ({
        path: ref.path,
        tableId,
        missingRowIds: [ref.rowId],
      }));
  }
}
