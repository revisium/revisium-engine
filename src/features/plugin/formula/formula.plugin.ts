import { Injectable } from '@nestjs/common';
import { getJsonValueStoreByPath } from '@revisium/schema-toolkit/lib';
import {
  JsonValueStore,
  JsonSchemaStore,
} from '@revisium/schema-toolkit/model';
import { JsonValue } from '@revisium/schema-toolkit/types';
import {
  ComputeRowsResult,
  FormulaFieldError,
  InternalAfterCreateRowOptions,
  InternalAfterMigrateRowsOptions,
  InternalAfterUpdateRowOptions,
  InternalComputeRowsOptions,
  IPluginService,
} from 'src/features/plugin/types';
import { calculateFormulaData } from 'src/features/plugin/formula/formula-calculation';

function evaluateFormulasInStore(
  schemaStore: JsonSchemaStore,
  valueStore: JsonValueStore,
): void {
  const schema = schemaStore.getPlainSchema();
  const data = valueStore.getPlainValue() as Record<string, unknown>;
  const result = calculateFormulaData(schema, data);

  for (const [path, value] of Object.entries(result.values)) {
    if (value !== undefined) {
      const store = getJsonValueStoreByPath(valueStore, path);
      if (store) {
        store.value = value as string | number | boolean;
      }
    }
  }
}

@Injectable()
export class FormulaPlugin implements IPluginService {
  public readonly isAvailable = true;

  public afterCreateRow(options: InternalAfterCreateRowOptions): void {
    evaluateFormulasInStore(options.schemaStore, options.valueStore);
  }

  public afterUpdateRow(options: InternalAfterUpdateRowOptions): void {
    evaluateFormulasInStore(options.schemaStore, options.valueStore);
  }

  public computeRows(options: InternalComputeRowsOptions): ComputeRowsResult {
    const schema = options.schemaStore.getPlainSchema();
    const allErrors = new Map<string, FormulaFieldError[]>();

    for (const row of options.rows) {
      const result = calculateFormulaData(
        schema,
        row.data as Record<string, unknown>,
      );

      if (result.errors.length > 0) {
        allErrors.set(row.id, result.errors);
      }

      row.data = result.data as JsonValue;
    }

    return allErrors.size > 0 ? { formulaErrors: allErrors } : {};
  }

  public afterMigrateRows(options: InternalAfterMigrateRowsOptions): void {
    const schema = options.schemaStore.getPlainSchema();

    for (const row of options.rows) {
      const result = calculateFormulaData(
        schema,
        row.data as Record<string, unknown>,
      );
      row.data = result.data as JsonValue;
    }
  }
}
