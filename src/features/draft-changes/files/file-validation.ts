import {
  createJsonSchemaStore,
  createJsonValueStore,
  pluginRefs,
} from '@revisium/schema-toolkit/lib';
import type {
  JsonObjectValueStore,
  JsonSchemaStore,
  JsonValueStore,
} from '@revisium/schema-toolkit/model';
import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { JsonSchemaTypeName } from '@revisium/schema-toolkit/types';
import type { JsonSchema, JsonValue } from '@revisium/schema-toolkit/types';
import { FileValueStore } from 'src/features/plugin/file/file-value.store';
import { validateFileDataForRestore } from 'src/features/plugin/file/utils/validate-file-data-for-restore';
import { ajvFileSchema } from 'src/features/share/schema/plugins';
import type { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import type {
  CandidateFileRow,
  RawFileOccurrence,
} from 'src/features/draft-changes/files/file-references';
import { unescapePointer } from 'src/features/draft-changes/schema/json-value-path';

export interface NativeFileCell {
  file: FileValueStore;
  store: JsonObjectValueStore;
}

export interface NativeFileRow {
  schemaStore: JsonSchemaStore;
  valueStore: JsonValueStore;
  cells: Map<string, NativeFileCell>;
}

export interface FileValidation {
  validateRaw(value: unknown): Promise<string | undefined>;
  validateNative(cell: NativeFileCell, row: NativeFileRow): string | undefined;
}

export function createFileValidation(
  validator: JsonSchemaValidatorService,
): FileValidation {
  const hash = validator.getSchemaHash(ajvFileSchema);
  return {
    async validateRaw(value) {
      const result = await validator.validate(
        structuredClone(value),
        ajvFileSchema,
        hash,
      );
      return result.result
        ? undefined
        : 'File value does not match the native file JSON schema.';
    },
    validateNative(cell, row) {
      try {
        validateFileDataForRestore(cell.file, row.valueStore);
        return undefined;
      } catch (error) {
        return error instanceof Error
          ? error.message
          : 'File value failed native restore validation.';
      }
    },
  };
}

export function createNativeFileRow(
  row: CandidateFileRow,
  schemaStores: Map<JsonSchema, JsonSchemaStore>,
): NativeFileRow | undefined {
  if (!row.schema) {
    return undefined;
  }
  let schemaStore = schemaStores.get(row.schema);
  if (!schemaStore) {
    schemaStore = createJsonSchemaStore(row.schema, pluginRefs);
    schemaStores.set(row.schema, schemaStore);
  }
  const valueStore = createJsonValueStore(
    schemaStore,
    row.row.id,
    structuredClone(row.row.data) as JsonValue,
  );
  return {
    schemaStore,
    valueStore,
    cells: collectNativeCells(valueStore, row.references),
  };
}

function collectNativeCells(
  valueStore: JsonValueStore,
  references: RawFileOccurrence[],
): Map<string, NativeFileCell> {
  const cells = new Map<string, NativeFileCell>();
  for (const reference of references) {
    const store = valueStoreAtPointer(valueStore, reference.path);
    if (
      store?.type === JsonSchemaTypeName.Object &&
      store.schema.$ref === SystemSchemaIds.File
    ) {
      cells.set(reference.path, { file: new FileValueStore(store), store });
    }
  }
  return cells;
}

function valueStoreAtPointer(
  root: JsonValueStore,
  pointer: string,
): JsonValueStore | undefined {
  let current: JsonValueStore | undefined = root;
  const segments = pointer === '' ? [] : pointer.split('/').slice(1);
  for (const encoded of segments) {
    const segment = unescapePointer(encoded);
    if (current?.type === JsonSchemaTypeName.Object) {
      current = current.value[segment];
    } else if (current?.type === JsonSchemaTypeName.Array) {
      current = current.value[Number(segment)];
    } else {
      return undefined;
    }
  }
  return current;
}
