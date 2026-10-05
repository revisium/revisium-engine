import { SchemaTable } from '@revisium/schema-toolkit/lib';
import type { JsonPatch, JsonSchema } from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import type {
  SchemaForeignKeyChange,
  SchemaForeignKeyRetarget,
  SchemaProjectionBlocker,
  SchemaProjectionState,
} from 'src/features/draft-changes/queries/impl/project-draft-changes-schema.query';
import { escapePointer } from 'src/features/draft-changes/schema/json-value-path';
import type { DraftChangesRevisionSnapshot } from 'src/features/draft-changes/queries/impl/read-draft-changes-snapshot.query';
import type { HistoryPatches } from 'src/features/share/queries/impl/transactional/get-table-schema.query';
import { exportSchemaModel } from 'src/features/draft-changes/schema/schema-model';
import type { HistoryGroup } from 'src/features/draft-changes/schema/schema-history';

type RevisionTable = DraftChangesRevisionSnapshot['tables'][number];

export type ValidatedForeignKeyRetarget = SchemaForeignKeyRetarget;
export interface ForeignKeyBinding {
  role: 'head' | 'draft';
  foreignKey: string;
  targetCreatedId?: string;
}

export type ForeignKeyProvenance = Map<string, ForeignKeyBinding>;

export type ForeignKeyRetargetValidation =
  | { retargets: ValidatedForeignKeyRetarget[] }
  | { blocker: SchemaProjectionBlocker };

export type ForeignKeyRetargetApplication =
  | { state: SchemaProjectionState; changes: SchemaForeignKeyChange[] }
  | { blocker: SchemaProjectionBlocker };

export function createForeignKeyProvenance(
  schema: JsonSchema,
  role: 'head' | 'draft',
): ForeignKeyProvenance {
  const provenance: ForeignKeyProvenance = new Map();
  collectProvenance(schema, '', role, provenance);
  return provenance;
}

export function applyForeignKeyHistoryProvenance(
  initial: ForeignKeyProvenance,
  groups: HistoryGroup[],
  futureGroups: HistoryGroup[] = [],
): ForeignKeyProvenance {
  const provenance = new Map(initial);
  for (const group of groups) {
    for (const [patchOffset, patch] of group.patches.entries()) {
      const patchIndex = group.patchIndexes[patchOffset];
      const futurePaths = findFutureForeignKeyPaths(
        futureGroups,
        group.historyIndex,
        patchIndex ?? -1,
      );
      if (patch.op === 'move') {
        moveProvenance(provenance, patch.from, patch.path);
      } else if (patch.op === 'remove') {
        deleteProvenance(provenance, patch.path);
      } else if (patch.path.endsWith('/foreignKey')) {
        const path = patch.path.slice(0, -'/foreignKey'.length);
        if (typeof patch.value === 'string') {
          provenance.set(path, {
            role: 'draft',
            foreignKey: patch.value,
          });
        } else {
          deleteProvenance(provenance, path);
        }
      } else {
        const previous = new Map(provenance);
        deleteProvenance(provenance, patch.path);
        collectProvenance(
          patch.value as JsonSchema,
          patch.path,
          'draft',
          provenance,
          previous,
          futurePaths,
        );
      }
    }
  }
  return provenance;
}

export function validateForeignKeyRetargets(
  retargets: SchemaForeignKeyRetarget[] | undefined,
  headTables: RevisionTable[],
  draftTables: RevisionTable[],
): ForeignKeyRetargetValidation {
  const validated: ValidatedForeignKeyRetarget[] = [];
  const seen = new Map<string, ValidatedForeignKeyRetarget>();

  for (const retarget of retargets ?? []) {
    const headTarget = findTableByCreatedId(
      headTables,
      retarget.targetTableCreatedId,
    );
    const draftTarget = findTableByCreatedId(
      draftTables,
      retarget.targetTableCreatedId,
    );
    if (
      !headTarget ||
      !draftTarget ||
      headTarget.id !== retarget.fromTableId ||
      draftTarget.id !== retarget.toTableId
    ) {
      return {
        blocker: invalidRetargetBlocker(),
      };
    }

    const duplicate = seen.get(retarget.targetTableCreatedId);
    if (duplicate) {
      if (
        duplicate.fromTableId !== retarget.fromTableId ||
        duplicate.toTableId !== retarget.toTableId
      ) {
        return { blocker: invalidRetargetBlocker() };
      }
      continue;
    }

    const item = { ...retarget };
    seen.set(retarget.targetTableCreatedId, item);
    validated.push(item);
  }

  return { retargets: validated };
}

export function applyForeignKeyRetargets(
  state: SchemaProjectionState,
  outputRole: 'head' | 'draft',
  tablesByRole: { head: RevisionTable[]; draft: RevisionTable[] },
  provenance: ForeignKeyProvenance,
  retargets: ValidatedForeignKeyRetarget[],
  operation: 'commit' | 'discard',
  refs: Record<string, JsonSchema>,
): ForeignKeyRetargetApplication {
  if (retargets.length === 0) {
    return { state: cloneState(state), changes: [] };
  }

  const createdIdsByName = {
    head: mapCreatedIdsByName(tablesByRole.head),
    draft: mapCreatedIdsByName(tablesByRole.draft),
  };

  const targetNames = new Map(
    retargets.map((retarget) => [
      retarget.targetTableCreatedId,
      operation === 'commit' ? retarget.toTableId : retarget.fromTableId,
    ]),
  );
  const changes: SchemaForeignKeyChange[] = [];
  const patches: JsonPatch[] = [];
  collectForeignKeyPatches(
    state.schema,
    '',
    createdIdsByName,
    provenance,
    targetNames,
    outputRole,
    changes,
    patches,
  );

  if (patches.length === 0) {
    return { state: cloneState(state), changes };
  }

  try {
    const table = new SchemaTable(structuredClone(state.schema), refs);
    table.applyPatches(structuredClone(patches));
    const schema = exportSchemaModel(table);
    const history = [
      ...structuredClone(state.history),
      createRetargetHistory(state.history, patches, schema),
    ];
    return {
      state: {
        schema,
        history,
        rows: structuredClone(state.rows),
      },
      changes,
    };
  } catch {
    return {
      blocker: {
        code: 'UNREPRESENTABLE_REMAINDER',
        message:
          'A foreign-key retarget could not be represented in schema history.',
      },
    };
  }
}

function mapCreatedIdsByName(tables: RevisionTable[]): Map<string, string[]> {
  const createdIdsByName = new Map<string, string[]>();
  for (const table of tables) {
    if (!table.system) {
      const ids = createdIdsByName.get(table.id) ?? [];
      ids.push(table.createdId);
      createdIdsByName.set(table.id, ids);
    }
  }
  return createdIdsByName;
}

function collectProvenance(
  schema: JsonSchema,
  path: string,
  role: 'head' | 'draft',
  provenance: ForeignKeyProvenance,
  previous: ForeignKeyProvenance = new Map(),
  futurePaths: Set<string> = new Set(),
): void {
  const node = schema as Record<string, unknown>;
  if (typeof node.foreignKey === 'string') {
    const previousBinding = previous.get(path);
    const preservePreviousBinding =
      previousBinding?.foreignKey === node.foreignKey &&
      [...futurePaths].some(
        (futurePath) =>
          isSameOrBelow(path, futurePath) || isSameOrBelow(futurePath, path),
      );
    provenance.set(path, {
      role,
      foreignKey: node.foreignKey,
      ...(preservePreviousBinding ? { role: previousBinding.role } : {}),
      ...(preservePreviousBinding && previousBinding.targetCreatedId
        ? { targetCreatedId: previousBinding.targetCreatedId }
        : {}),
    });
  }
  collectPropertyProvenance(
    node.properties,
    path,
    role,
    provenance,
    previous,
    futurePaths,
  );
  collectKeywordProvenance(node, path, role, provenance, previous, futurePaths);
}

function collectPropertyProvenance(
  properties: unknown,
  path: string,
  role: 'head' | 'draft',
  provenance: ForeignKeyProvenance,
  previous: ForeignKeyProvenance,
  futurePaths: Set<string>,
): void {
  if (!isRecord(properties)) {
    return;
  }
  for (const [name, child] of Object.entries(properties)) {
    if (isRecord(child)) {
      collectProvenance(
        child as JsonSchema,
        `${path}/properties/${escapePointer(name)}`,
        role,
        provenance,
        previous,
        futurePaths,
      );
    }
  }
}

function collectKeywordProvenance(
  node: Record<string, unknown>,
  path: string,
  role: 'head' | 'draft',
  provenance: ForeignKeyProvenance,
  previous: ForeignKeyProvenance,
  futurePaths: Set<string>,
): void {
  for (const keyword of schemaArrayKeywords) {
    const children = node[keyword];
    if (Array.isArray(children)) {
      children.forEach((child, index) => {
        if (isRecord(child)) {
          collectProvenance(
            child as JsonSchema,
            `${path}/${keyword}/${index}`,
            role,
            provenance,
            previous,
            futurePaths,
          );
        }
      });
    }
  }
  for (const keyword of schemaSingleKeywords) {
    const child = node[keyword];
    if (isRecord(child)) {
      collectProvenance(
        child as JsonSchema,
        `${path}/${keyword}`,
        role,
        provenance,
        previous,
        futurePaths,
      );
    }
  }
}

function moveProvenance(
  provenance: ForeignKeyProvenance,
  from: string,
  to: string,
): void {
  const moved = [...provenance].filter(([path]) => isSameOrBelow(path, from));
  deleteProvenance(provenance, to);
  deleteProvenance(provenance, from);
  for (const [path, binding] of moved) {
    provenance.set(`${to}${path.slice(from.length)}`, binding);
  }
}

function deleteProvenance(
  provenance: ForeignKeyProvenance,
  path: string,
): void {
  for (const key of provenance.keys()) {
    if (isSameOrBelow(key, path)) {
      provenance.delete(key);
    }
  }
}

function isSameOrBelow(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function collectForeignKeyPatches(
  schema: JsonSchema,
  path: string,
  createdIdsByName: {
    head: Map<string, string[]>;
    draft: Map<string, string[]>;
  },
  provenance: ForeignKeyProvenance,
  targetNames: Map<string, string>,
  outputRole: 'head' | 'draft',
  changes: SchemaForeignKeyChange[],
  patches: JsonPatch[],
): void {
  const node = schema as Record<string, unknown>;
  collectNodeForeignKeyPatch(
    node,
    path,
    createdIdsByName,
    provenance,
    targetNames,
    outputRole,
    changes,
    patches,
  );
  collectPropertyPatches(
    node.properties,
    path,
    createdIdsByName,
    provenance,
    targetNames,
    outputRole,
    changes,
    patches,
  );
  collectKeywordPatches(
    node,
    path,
    createdIdsByName,
    provenance,
    targetNames,
    outputRole,
    changes,
    patches,
  );
}

function collectNodeForeignKeyPatch(
  node: Record<string, unknown>,
  path: string,
  createdIdsByName: {
    head: Map<string, string[]>;
    draft: Map<string, string[]>;
  },
  provenance: ForeignKeyProvenance,
  targetNames: Map<string, string>,
  outputRole: 'head' | 'draft',
  changes: SchemaForeignKeyChange[],
  patches: JsonPatch[],
): void {
  if (typeof node.foreignKey === 'string') {
    const binding = provenance.get(path);
    const targetCreatedId = resolveBoundTargetCreatedId(
      node.foreignKey,
      binding,
      outputRole,
      createdIdsByName,
      targetNames,
    );
    const targetName = targetCreatedId
      ? targetNames.get(targetCreatedId)
      : undefined;
    if (
      targetCreatedId !== undefined &&
      targetName !== undefined &&
      targetName !== node.foreignKey
    ) {
      changes.push({
        role: outputRole,
        targetTableCreatedId: targetCreatedId,
        path,
        before: node.foreignKey,
        after: targetName,
      });
      patches.push({
        op: 'replace',
        path,
        value: {
          ...structuredClone(node),
          foreignKey: targetName,
        } as JsonSchema,
      });
    }
  }
}

function resolveBoundTargetCreatedId(
  tableId: string,
  binding: ForeignKeyBinding | undefined,
  outputRole: 'head' | 'draft',
  createdIdsByName: {
    head: Map<string, string[]>;
    draft: Map<string, string[]>;
  },
  targetNames: Map<string, string>,
): string | undefined {
  if (binding?.targetCreatedId && targetNames.has(binding.targetCreatedId)) {
    return binding.targetCreatedId;
  }
  const bindingRole = binding?.role ?? outputRole;
  const matchingCreatedIds = createdIdsByName[bindingRole].get(tableId) ?? [];
  if (matchingCreatedIds.length === 1) {
    return matchingCreatedIds[0];
  }
  return undefined;
}

function findFutureForeignKeyPaths(
  groups: HistoryGroup[],
  historyIndex: number,
  patchIndex: number,
): Set<string> {
  const paths = new Set<string>();
  for (const group of groups) {
    for (const [patchOffset, patch] of group.patches.entries()) {
      const futurePatchIndex = group.patchIndexes[patchOffset];
      if (
        group.historyIndex < historyIndex ||
        (group.historyIndex === historyIndex &&
          (futurePatchIndex === undefined || futurePatchIndex <= patchIndex))
      ) {
        continue;
      }
      if (patch.op === 'remove') {
        continue;
      }
      paths.add(
        patch.path.endsWith('/foreignKey')
          ? patch.path.slice(0, -'/foreignKey'.length)
          : patch.path,
      );
    }
  }
  return paths;
}

function collectPropertyPatches(
  properties: unknown,
  path: string,
  createdIdsByName: {
    head: Map<string, string[]>;
    draft: Map<string, string[]>;
  },
  provenance: ForeignKeyProvenance,
  targetNames: Map<string, string>,
  outputRole: 'head' | 'draft',
  changes: SchemaForeignKeyChange[],
  patches: JsonPatch[],
): void {
  if (!isRecord(properties)) {
    return;
  }
  for (const [name, child] of Object.entries(properties)) {
    if (isRecord(child)) {
      collectForeignKeyPatches(
        child as JsonSchema,
        `${path}/properties/${escapePointer(name)}`,
        createdIdsByName,
        provenance,
        targetNames,
        outputRole,
        changes,
        patches,
      );
    }
  }
}

function collectKeywordPatches(
  node: Record<string, unknown>,
  path: string,
  createdIdsByName: {
    head: Map<string, string[]>;
    draft: Map<string, string[]>;
  },
  provenance: ForeignKeyProvenance,
  targetNames: Map<string, string>,
  outputRole: 'head' | 'draft',
  changes: SchemaForeignKeyChange[],
  patches: JsonPatch[],
): void {
  for (const keyword of schemaArrayKeywords) {
    collectArrayKeywordPatches(
      node[keyword],
      `${path}/${keyword}`,
      createdIdsByName,
      provenance,
      targetNames,
      outputRole,
      changes,
      patches,
    );
  }

  for (const keyword of schemaSingleKeywords) {
    const child = node[keyword];
    if (isRecord(child)) {
      collectForeignKeyPatches(
        child as JsonSchema,
        `${path}/${keyword}`,
        createdIdsByName,
        provenance,
        targetNames,
        outputRole,
        changes,
        patches,
      );
    }
  }
}

function collectArrayKeywordPatches(
  children: unknown,
  path: string,
  createdIdsByName: {
    head: Map<string, string[]>;
    draft: Map<string, string[]>;
  },
  provenance: ForeignKeyProvenance,
  targetNames: Map<string, string>,
  outputRole: 'head' | 'draft',
  changes: SchemaForeignKeyChange[],
  patches: JsonPatch[],
): void {
  if (!Array.isArray(children)) {
    return;
  }
  children.forEach((child, index) => {
    if (isRecord(child)) {
      collectForeignKeyPatches(
        child as JsonSchema,
        `${path}/${index}`,
        createdIdsByName,
        provenance,
        targetNames,
        outputRole,
        changes,
        patches,
      );
    }
  });
}

function createRetargetHistory(
  history: HistoryPatches[],
  patches: JsonPatch[],
  schema: JsonSchema,
): HistoryPatches {
  const source = history[history.length - 1];
  if (!source) {
    throw new Error('Validated schema history has no entries.');
  }
  return {
    date: source.date,
    patches: structuredClone(patches),
    hash: objectHash(schema),
  };
}

function findTableByCreatedId(
  tables: RevisionTable[],
  createdId: string,
): RevisionTable | undefined {
  const matches = tables.filter(
    (table) => !table.system && table.createdId === createdId,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function invalidRetargetBlocker(): SchemaProjectionBlocker {
  return {
    code: 'INVALID_EFFECT_REFERENCE',
    message:
      'A foreign-key retarget does not match its original stable table identity.',
  };
}

function cloneState(state: SchemaProjectionState): SchemaProjectionState {
  return {
    schema: structuredClone(state.schema),
    history: structuredClone(state.history),
    rows: structuredClone(state.rows),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const schemaArrayKeywords = ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const;

const schemaSingleKeywords = [
  'items',
  'additionalProperties',
  'not',
  'contains',
  '$defs',
  'definitions',
] as const;
