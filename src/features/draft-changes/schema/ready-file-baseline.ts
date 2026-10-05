import {
  createJsonSchemaStore,
  createJsonValueStore,
  pluginRefs,
} from '@revisium/schema-toolkit/lib';
import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import type { JsonValue } from '@revisium/schema-toolkit/types';
import type {
  SchemaFileSlotProjectionBinding,
  SchemaProjectionRow,
} from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import { initializeReadyFile } from 'src/features/plugin/file/utils/initialize-ready-file';
import { FileValueStore } from 'src/features/plugin/file/file-value.store';
import {
  isObject,
  missingValue,
  readJsonPath,
  setJsonPath,
} from 'src/features/draft-changes/schema/json-value-path';

export function applyReadyFileBaseline(
  rows: SchemaProjectionRow[],
  sourceRows: Array<{ createdId: string; data: JsonValue }>,
  slots: SchemaFileSlotProjectionBinding[],
  role: 'head' | 'draft',
): SchemaProjectionRow[] {
  const byId = new Map(sourceRows.map((row) => [row.createdId, row.data]));
  const applicable = slots.filter((slot) => slot.role === role);
  if (applicable.length === 0) {
    return rows;
  }
  const fileSchema = pluginRefs[SystemSchemaIds.File];
  if (!fileSchema) {
    return rows;
  }
  const fileSchemaStore = createJsonSchemaStore(fileSchema, pluginRefs);
  return rows.map((row) => {
    const sourceData = byId.get(row.createdId);
    if (sourceData === undefined) {
      return row;
    }
    let data = structuredClone(row.data) as JsonValue;
    for (const slot of applicable) {
      const source = readJsonPath(sourceData, slot.sourceDraftPath);
      if (
        source === missingValue ||
        !isObject(source) ||
        typeof source.fileId !== 'string' ||
        !/^[A-Za-z0-9_-]{21}$/.test(source.fileId) ||
        !['ready', 'uploaded'].includes(String(source.status))
      ) {
        continue;
      }
      const fileValueStore = createJsonValueStore(
        fileSchemaStore,
        row.createdId,
        fileSchemaStore.default,
      );
      if (fileValueStore.type !== 'object') {
        continue;
      }
      const file = new FileValueStore(fileValueStore);
      initializeReadyFile(file, source.fileId);
      const update = setJsonPath(
        data,
        slot.projectedPath,
        fileValueStore.getPlainValue(),
      );
      if (update.representable) {
        data = update.value;
      }
    }
    return { ...row, data };
  });
}
