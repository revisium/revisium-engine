import { SchemaTable, pluginRefs } from '@revisium/schema-toolkit/lib';
import type {
  JsonPatch,
  JsonSchema,
  JsonValue,
} from '@revisium/schema-toolkit/types';
import type { DraftChangesCatalogueEntry } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import type { DraftChangesSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { SchemaEffectRef } from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import type { HistoryPatches } from 'src/features/share/queries/impl/transactional/get-table-schema.query';
import {
  applyFieldLineage,
  createFieldIdentities,
} from 'src/features/draft-changes/schema/field-lineage';
import type { HistoryGroup } from 'src/features/draft-changes/schema/schema-history';
import {
  missingValue,
  readJsonPath,
} from 'src/features/draft-changes/schema/json-value-path';
import { SystemTables } from 'src/features/share/system-tables.consts';

interface SchemaTableState {
  schema: JsonSchema;
  history: HistoryPatches[];
}

interface EffectLineage {
  identity: string;
  firstPath: string;
  classification: DraftChangesCatalogueEntry['classification'];
  refs: SchemaEffectRef[];
  before?: JsonValue;
  beforeExists: boolean;
  after?: JsonValue;
  afterExists: boolean;
  terminalPath: string;
}

export function buildSchemaEffectEntries(
  snapshot: DraftChangesSnapshot,
  tableCreatedId: string,
  tableId: string,
): DraftChangesCatalogueEntry[] {
  const head = getSchemaTable(snapshot.head, tableCreatedId);
  const draft = getSchemaTable(snapshot.draft, tableCreatedId);
  if (!head || !draft) {
    return [];
  }

  const lineages = new Map<string, EffectLineage>();
  let schema = structuredClone(head.schema);
  let identities = createFieldIdentities(schema);
  for (
    let historyIndex = head.history.length;
    historyIndex < draft.history.length;
    historyIndex += 1
  ) {
    const history = draft.history[historyIndex];
    if (!history) {
      continue;
    }
    const table = new SchemaTable(structuredClone(schema), pluginRefs);
    for (
      let patchIndex = 0;
      patchIndex < history.patches.length;
      patchIndex += 1
    ) {
      const patch = history.patches[patchIndex];
      if (!patch) {
        continue;
      }
      const effectRef = { historyIndex, patchIndex };
      const previousSchema = table.getSchema();
      const beforeIdentities = identities;
      table.applyPatches([structuredClone(patch)]);
      schema = table.getSchema();
      identities = applyFieldLineage(beforeIdentities, [
        historyGroup(historyIndex, history, patch, patchIndex),
      ]);
      recordEffect(
        lineages,
        patch,
        effectRef,
        previousSchema,
        schema,
        beforeIdentities,
        identities,
      );
    }
  }
  return [...lineages.values()]
    .map((lineage) => makeEntry(lineage, identities, tableCreatedId, tableId))
    .sort(compareEffectPosition);
}

function historyGroup(
  historyIndex: number,
  source: HistoryPatches,
  patch: JsonPatch,
  patchIndex: number,
): HistoryGroup {
  return { historyIndex, source, patches: [patch], patchIndexes: [patchIndex] };
}

function recordEffect(
  lineages: Map<string, EffectLineage>,
  patch: JsonPatch,
  effectRef: SchemaEffectRef,
  beforeSchema: JsonSchema,
  afterSchema: JsonSchema,
  beforeIdentities: Map<string, string>,
  afterIdentities: Map<string, string>,
): void {
  recordRootEffect(
    lineages,
    patch,
    effectRef,
    beforeSchema,
    afterSchema,
    beforeIdentities,
    afterIdentities,
  );
  if (patch.op === 'move') {
    recordMovedDescendants(lineages, patch, beforeIdentities, afterIdentities);
  }
}

function recordRootEffect(
  lineages: Map<string, EffectLineage>,
  patch: JsonPatch,
  effectRef: SchemaEffectRef,
  beforeSchema: JsonSchema,
  afterSchema: JsonSchema,
  beforeIdentities: Map<string, string>,
  afterIdentities: Map<string, string>,
): void {
  const sourcePath = patch.op === 'move' ? patch.from : patch.path;
  const rootIdentity =
    patch.op === 'remove'
      ? beforeIdentities.get(sourcePath)
      : afterIdentities.get(patch.path);
  if (rootIdentity) {
    const prior = lineages.get(rootIdentity);
    const classification =
      prior?.classification ?? initialClassification(patch);
    addEffect(
      lineages,
      rootIdentity,
      sourcePath,
      classification,
      effectRef,
      beforeSchema,
      afterSchema,
      patch.op === 'remove' ? undefined : patch.path,
    );
    const lineage = lineages.get(rootIdentity);
    if (lineage && (patch.op === 'move' || patch.op === 'remove')) {
      lineage.terminalPath = patch.path;
    }
  }
}

function recordMovedDescendants(
  lineages: Map<string, EffectLineage>,
  patch: Extract<JsonPatch, { op: 'move' }>,
  beforeIdentities: Map<string, string>,
  afterIdentities: Map<string, string>,
): void {
  for (const [path, identity] of beforeIdentities) {
    if (path === patch.from || !isAtOrBelow(path, patch.from)) {
      continue;
    }
    const existing = lineages.get(identity);
    if (!existing) {
      continue;
    }
    existing.terminalPath =
      afterPathForIdentity(afterIdentities, identity) ??
      `${patch.path}${path.slice(patch.from.length)}`;
  }
}

function addEffect(
  lineages: Map<string, EffectLineage>,
  identity: string,
  path: string,
  classification: DraftChangesCatalogueEntry['classification'],
  effectRef: SchemaEffectRef,
  beforeSchema: JsonSchema,
  afterSchema: JsonSchema,
  afterPath: string | undefined,
): void {
  const existing = lineages.get(identity);
  if (existing) {
    existing.refs.push(effectRef);
    if (afterPath !== undefined) {
      existing.terminalPath = afterPath;
    }
    setAfterValue(existing, afterSchema, afterPath);
    return;
  }
  const before = readJsonPath(beforeSchema as JsonValue, path);
  const lineage: EffectLineage = {
    identity,
    firstPath: path,
    classification,
    refs: [effectRef],
    beforeExists: before !== missingValue,
    ...(before === missingValue ? {} : { before }),
    afterExists: false,
    terminalPath: afterPath ?? path,
  };
  setAfterValue(lineage, afterSchema, afterPath);
  lineages.set(identity, lineage);
}

function setAfterValue(
  lineage: EffectLineage,
  schema: JsonSchema,
  path: string | undefined,
): void {
  const after =
    path === undefined ? missingValue : readJsonPath(schema as JsonValue, path);
  lineage.afterExists = after !== missingValue;
  if (after === missingValue) {
    delete lineage.after;
  } else {
    lineage.after = after;
  }
}

function initialClassification(
  patch: JsonPatch,
): DraftChangesCatalogueEntry['classification'] {
  if (patch.op === 'add') {
    return 'created';
  }
  if (patch.op === 'remove') {
    return 'deleted';
  }
  if (patch.op === 'move') {
    return 'renamed';
  }
  return 'updated';
}

function makeEntry(
  lineage: EffectLineage,
  identities: Map<string, string>,
  tableCreatedId: string,
  tableId: string,
): DraftChangesCatalogueEntry {
  const identityPath = afterPathForIdentity(identities, lineage.identity);
  const terminalPath = identityPath ?? lineage.terminalPath;
  const afterExists = identityPath !== undefined && lineage.afterExists;
  const path = terminalPath;
  return {
    ref: { value: '' },
    kind: 'schemaField',
    target: { kind: 'schemaField', tableCreatedId, tableId, path },
    classification: lineage.classification,
    path,
    ...(lineage.classification === 'renamed'
      ? { previousPath: lineage.firstPath }
      : {}),
    ...(lineage.beforeExists ? { before: lineage.before } : {}),
    ...(afterExists ? { after: lineage.after } : {}),
    beforeExists: lineage.beforeExists,
    afterExists,
    selectable: true,
    effectRefs: uniqueRefs(lineage.refs),
  };
}

function uniqueRefs(refs: SchemaEffectRef[]): SchemaEffectRef[] {
  const seen = new Set<string>();
  return refs.filter(({ historyIndex, patchIndex }) => {
    const key = `${historyIndex}:${patchIndex}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function afterPathForIdentity(
  identities: Map<string, string>,
  identity: string,
): string | undefined {
  return [...identities].find(
    ([, currentIdentity]) => currentIdentity === identity,
  )?.[0];
}

function getSchemaTable(
  revision: DraftChangesSnapshot['head'],
  tableCreatedId: string,
): SchemaTableState | undefined {
  const table = revision.tables.find(
    ({ createdId, system }) => createdId === tableCreatedId && !system,
  );
  if (!table) {
    return undefined;
  }
  const schemaTable = revision.tables.find(
    ({ id }) => id === SystemTables.Schema,
  );
  const rows = schemaTable?.rows.filter(({ id }) => id === table.id) ?? [];
  if (rows.length !== 1) {
    return undefined;
  }
  const row = rows[0];
  if (!row || !Array.isArray(row.meta)) {
    return undefined;
  }
  return {
    schema: row.data as JsonSchema,
    history: row.meta as HistoryPatches[],
  };
}

function compareEffectPosition(
  left: DraftChangesCatalogueEntry,
  right: DraftChangesCatalogueEntry,
): number {
  const a = left.effectRefs?.[0];
  const b = right.effectRefs?.[0];
  return (
    (a?.historyIndex ?? -1) - (b?.historyIndex ?? -1) ||
    (a?.patchIndex ?? -1) - (b?.patchIndex ?? -1)
  );
}

function isAtOrBelow(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}/`);
}
