import type { JsonValue } from '@revisium/schema-toolkit/types';
import { attachChangeReferences } from 'src/features/draft-changes/catalogue/change-references';
import {
  missingValue,
  readJsonPath,
} from 'src/features/draft-changes/schema/json-value-path';
import type {
  DraftChangesCatalogue,
  DraftChangesCatalogueEntry,
} from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { ProjectedRowValues } from './project-native-row-values';

export function mergeProjectedCatalogue({
  catalogue: source,
  rowValues,
  supplementalEntries,
}: {
  catalogue: DraftChangesCatalogue;
  rowValues: ProjectedRowValues[];
  supplementalEntries: DraftChangesCatalogueEntry[];
}): DraftChangesCatalogue {
  const catalogue = structuredClone(source);
  const entriesByRow = new Map<string, number[]>();
  const entriesByTarget = new Map<string, number[]>();
  catalogue.entries.forEach((entry, index) => {
    if (entry.kind !== 'rowField' || entry.target.kind !== 'rowField') {
      return;
    }
    appendIndex(
      entriesByRow,
      rowKey(entry.target.tableCreatedId, entry.target.rowCreatedId),
      index,
    );
    appendIndex(
      entriesByTarget,
      targetKey(
        entry.target.tableCreatedId,
        entry.target.rowCreatedId,
        entry.target.path,
      ),
      index,
    );
  });

  for (const row of rowValues) {
    const indices =
      entriesByRow.get(rowKey(row.tableCreatedId, row.rowCreatedId)) ?? [];
    for (const index of indices) {
      const entry = catalogue.entries[index];
      if (
        !entry ||
        entry.kind !== 'rowField' ||
        entry.target.kind !== 'rowField'
      ) {
        continue;
      }
      catalogue.entries[index] = overlayRowField(
        entry,
        row.beforeData,
        row.afterData,
      );
    }
  }

  for (const entry of supplementalEntries) {
    if (
      entry.kind !== 'rowField' ||
      entry.target.kind !== 'rowField' ||
      entry.classification !== 'computed' ||
      entry.selectable
    ) {
      continue;
    }
    const key = targetKey(
      entry.target.tableCreatedId,
      entry.target.rowCreatedId,
      entry.target.path,
    );
    if (entriesByTarget.has(key)) {
      continue;
    }
    const [referenced] = attachChangeReferences([entry], catalogue.scope);
    if (!referenced) {
      continue;
    }
    const index = catalogue.entries.length;
    catalogue.entries.push(referenced);
    appendIndex(
      entriesByRow,
      rowKey(entry.target.tableCreatedId, entry.target.rowCreatedId),
      index,
    );
    appendIndex(entriesByTarget, key, index);
  }
  return catalogue;
}

function overlayRowField(
  entry: DraftChangesCatalogueEntry,
  beforeData: JsonValue,
  afterData: JsonValue,
): DraftChangesCatalogueEntry {
  if (entry.target.kind !== 'rowField') {
    return entry;
  }
  const before = readJsonPath(beforeData, entry.target.path);
  const after = readJsonPath(afterData, entry.target.path);
  const enriched = {
    ...entry,
    beforeExists: before !== missingValue,
    afterExists: after !== missingValue,
  };
  if (before === missingValue) {
    delete enriched.before;
  } else {
    enriched.before = before;
  }
  if (after === missingValue) {
    delete enriched.after;
  } else {
    enriched.after = after;
  }
  return enriched;
}

function appendIndex(
  index: Map<string, number[]>,
  key: string,
  value: number,
): void {
  const values = index.get(key) ?? [];
  values.push(value);
  index.set(key, values);
}

function rowKey(tableCreatedId: string, rowCreatedId: string): string {
  return JSON.stringify([tableCreatedId, rowCreatedId]);
}

function targetKey(
  tableCreatedId: string,
  rowCreatedId: string,
  path: string,
): string {
  return JSON.stringify([tableCreatedId, rowCreatedId, path]);
}
