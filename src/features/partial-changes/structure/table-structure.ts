import { deepEqual } from '@revisium/schema-toolkit/lib';
import type {
  JsonPatch,
  JsonSchema,
  Migration,
} from '@revisium/schema-toolkit/types';
import type { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';
import { normalizedLeafSchema } from 'src/features/partial-changes/structure/normalized-leaf-schema';
import {
  hasPendingEntries,
  isStructureRecorded,
  pendingSchemaHistory,
  type PendingSchemaHistory,
} from 'src/features/partial-changes/structure/pending-schema-history';
import {
  dataPointerOfSchemaPath,
  type SchemaLeaf,
  SchemaLeaves,
} from 'src/features/partial-changes/structure/schema-leaves';
import type { NativeSchemaRules } from 'src/features/share/ledger-replay/native-schema-rules';
import { schemasEqual } from 'src/features/share/ledger-replay/schemas-equal';
import type { HistoryPatches } from 'src/features/share/queries/impl';

export type TableIdentities = ReadonlyMap<string, string>;

export interface TableSide {
  readonly schema: JsonSchema;
  readonly history: readonly HistoryPatches[];
  readonly tableIdentities: TableIdentities;
}

export interface TableStructureInput {
  readonly head: TableSide;
  readonly draft: TableSide;
  readonly pendingMigrations: readonly Migration[];
}

export type PublishedAtOwner =
  | { readonly owner: 'field'; readonly pointer: JsonPointer }
  | { readonly owner: 'structure' }
  | { readonly owner: 'rowColumns' };

export interface TableStructure {
  readonly pendingHistory: PendingSchemaHistory;
  readonly recorded: boolean;
  readonly differs: boolean;
  readonly unchangedLeaves: readonly SchemaLeaf[];
  readonly changedPointers: readonly JsonPointer[];
  readonly publishedAtOwner: PublishedAtOwner;
}

export function analyzeTableStructure(
  input: TableStructureInput,
  rules: NativeSchemaRules,
): TableStructure {
  const pendingHistory = pendingSchemaHistory(
    input.head.history,
    input.draft.history,
  );
  const leaves = new LeafComparison(input);
  const changedPointers = leaves.changedPointers();

  return {
    pendingHistory,
    recorded: isStructureRecorded(
      input.head.schema,
      pendingHistory,
      input.draft.schema,
      rules,
    ),
    differs: structureDiffers(input, pendingHistory, changedPointers),
    unchangedLeaves: leaves.unchanged,
    changedPointers,
    publishedAtOwner: leaves.publishedAtOwner(),
  };
}

function structureDiffers(
  input: TableStructureInput,
  pendingHistory: PendingSchemaHistory,
  changedPointers: readonly JsonPointer[],
): boolean {
  return (
    hasPendingEntries(pendingHistory) ||
    !schemasEqual(input.head.schema, input.draft.schema) ||
    changedPointers.length > 0
  );
}

class LeafComparison {
  public readonly unchanged: readonly SchemaLeaf[];

  private readonly headLeaves: SchemaLeaves;
  private readonly draftLeaves: SchemaLeaves;
  private readonly pendingPatchPointers: readonly JsonPointer[];

  constructor(private readonly input: TableStructureInput) {
    this.headLeaves = SchemaLeaves.of(input.head.schema);
    this.draftLeaves = SchemaLeaves.of(input.draft.schema);
    this.pendingPatchPointers = pendingPatchPointers(input.pendingMigrations);
    this.unchanged = this.draftLeaves.all.filter((leaf) =>
      this.isUnchanged(leaf),
    );
  }

  public changedPointers(): JsonPointer[] {
    const unchanged = new Set(this.unchanged.map(pointerKey));
    const changed = new Map<string, JsonPointer>();

    for (const leaf of [...this.draftLeaves.all, ...this.headLeaves.all]) {
      if (!unchanged.has(pointerKey(leaf))) {
        changed.set(pointerKey(leaf), leaf.pointer);
      }
    }

    return [...changed.values()];
  }

  public publishedAtOwner(): PublishedAtOwner {
    const field = this.draftLeaves.publishedAtField();

    if (!field) {
      return { owner: 'rowColumns' };
    }

    if (this.unchanged.includes(field)) {
      return { owner: 'field', pointer: field.pointer };
    }

    return { owner: 'structure' };
  }

  private isUnchanged(draftLeaf: SchemaLeaf): boolean {
    const headLeaf = this.headLeaves.at(draftLeaf.pointer);

    return (
      headLeaf !== undefined &&
      this.haveEqualSchemas(headLeaf, draftLeaf) &&
      !this.isTouchedByPendingPatch(draftLeaf)
    );
  }

  private haveEqualSchemas(
    headLeaf: SchemaLeaf,
    draftLeaf: SchemaLeaf,
  ): boolean {
    return deepEqual(
      normalizedLeafSchema(headLeaf.schema, this.input.head.tableIdentities),
      normalizedLeafSchema(draftLeaf.schema, this.input.draft.tableIdentities),
    );
  }

  private isTouchedByPendingPatch(leaf: SchemaLeaf): boolean {
    return this.pendingPatchPointers.some((pointer) =>
      pointer.isAtOrAbove(leaf.pointer),
    );
  }
}

function pendingPatchPointers(migrations: readonly Migration[]): JsonPointer[] {
  return migrations
    .flatMap(patchesOf)
    .flatMap(schemaPathsOf)
    .map((schemaPath) => dataPointerOfSchemaPath(schemaPath));
}

function patchesOf(migration: Migration): JsonPatch[] {
  if (migration.changeType !== 'update') {
    return [];
  }

  return migration.patches;
}

function schemaPathsOf(patch: JsonPatch): string[] {
  if (patch.op === 'move') {
    return [patch.from, patch.path];
  }

  return [patch.path];
}

function pointerKey(leaf: SchemaLeaf): string {
  return leaf.pointer.toString();
}
