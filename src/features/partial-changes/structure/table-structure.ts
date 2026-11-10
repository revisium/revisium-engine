import { deepEqual } from '@revisium/schema-toolkit/lib';
import type {
  JsonPatch,
  JsonSchema,
  Migration,
} from '@revisium/schema-toolkit/types';
import type { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';
import {
  type NodeOrigin,
  NodeOrigins,
  type PatchEffect,
  pointersTouchedBy,
  replayPendingPatches,
} from 'src/features/partial-changes/structure/node-origins';
import {
  ANNOTATION_KEYWORDS,
  type AnnotationKeyword,
  leafSchemaWithAnnotation,
  normalizedLeafSchema,
  ownAnnotationsDifferingBetween,
  validatingLeafSchema,
} from 'src/features/partial-changes/structure/normalized-leaf-schema';
import {
  dataPointerOfSchemaPath,
  nestedObjectsOf,
  type SchemaLeaf,
  SchemaLeaves,
  type SchemaNode,
} from 'src/features/partial-changes/structure/schema-leaves';
import { isStructureRecorded } from 'src/features/partial-changes/structure/structure-recorded';
import {
  historyDiffersFromHead,
  pendingSchemaHistory,
  type PendingSchemaHistory,
} from 'src/features/share/ledger/pending-schema-history';
import type { NativeSchemaRules } from 'src/features/share/ledger-replay/native-schema-rules';
import { schemasEqual } from 'src/features/share/ledger-replay/schemas-equal';
import type { HistoryPatches } from 'src/features/share/queries/impl';

export type TableIdentities = ReadonlyMap<string, string>;

export interface TableSide {
  readonly tableId: string;
  readonly schema: JsonSchema;
  readonly history: readonly HistoryPatches[];
  readonly tableIdentities: TableIdentities;
}

export interface TableStructureInput {
  readonly head: TableSide;
  readonly draft: TableSide;
  readonly pendingMigrations: readonly Migration[];
  readonly replayedHeadSchema?: JsonSchema;
}

export type PublishedAtOwner =
  | { readonly owner: 'field'; readonly pointer: JsonPointer }
  | { readonly owner: 'structure' }
  | { readonly owner: 'rowColumns' };

export const STRUCTURE_FIELD_CHANGES = [
  'added',
  'removed',
  'changed',
  'moved',
  'annotated',
] as const;

export type StructureFieldChange = (typeof STRUCTURE_FIELD_CHANGES)[number];

export interface ChangedLeaf {
  readonly pointer: JsonPointer;
  readonly change: StructureFieldChange;
  readonly from?: JsonPointer;
  readonly annotations?: readonly AnnotationKeyword[];
}

export interface AnnotatedObject {
  readonly pointer: JsonPointer;
  readonly annotations: readonly AnnotationKeyword[];
}

export interface TableStructure {
  readonly pendingHistory: PendingSchemaHistory;
  readonly recorded: boolean;
  readonly differs: boolean;
  readonly differsBeyondTableId: boolean;
  readonly unchangedLeaves: readonly SchemaLeaf[];
  readonly changedPointers: readonly JsonPointer[];
  readonly changedLeaves: readonly ChangedLeaf[];
  readonly annotatedObjects: readonly AnnotatedObject[];
  readonly publishedAtOwner: PublishedAtOwner;
}

type LeafOrigin = NodeOrigin<SchemaLeaf>;

const WITHOUT_PROVENANCE: readonly PatchEffect[] = [];

export function analyzeTableStructure(
  input: TableStructureInput,
  rules: NativeSchemaRules,
): TableStructure {
  const pendingHistory = pendingSchemaHistory(
    input.head.history,
    input.draft.history,
  );
  const pendingBatches = input.pendingMigrations.flatMap(patchBatchOf);
  const pendingEffects = replayPendingPatches(
    input.head.schema,
    pendingBatches,
    rules,
  );
  const leaves = new LeafComparison(
    input.head,
    input.draft,
    pendingPatchPointers(pendingBatches, pendingEffects),
  );
  const changedPointers = leaves.changedPointers();
  const differsBeyondTableId = structureDiffersBeyondTableId(
    input,
    pendingHistory,
    changedPointers,
  );

  return {
    pendingHistory,
    recorded: headBaselinesOf(input).some((baseline) =>
      isStructureRecorded(baseline, pendingHistory, input.draft.schema, rules),
    ),
    differs: structureDiffers(input, differsBeyondTableId),
    differsBeyondTableId,
    unchangedLeaves: leaves.unchanged,
    changedPointers,
    changedLeaves: leaves.changedLeaves(pendingEffects ?? WITHOUT_PROVENANCE),
    annotatedObjects: leaves.annotatedObjects(
      pendingEffects ?? WITHOUT_PROVENANCE,
    ),
    publishedAtOwner: leaves.publishedAtOwner(),
  };
}

export function changedLeavesOfReplacedTable(
  removed: TableSide,
  created: TableSide,
): ChangedLeaf[] {
  return new LeafComparison(removed, created, []).changedLeaves(
    WITHOUT_PROVENANCE,
  );
}

function headBaselinesOf({
  head,
  replayedHeadSchema,
}: TableStructureInput): JsonSchema[] {
  if (replayedHeadSchema === undefined) {
    return [head.schema];
  }

  return [head.schema, replayedHeadSchema];
}

function structureDiffers(
  input: TableStructureInput,
  differsBeyondTableId: boolean,
): boolean {
  return (
    input.head.tableId !== input.draft.tableId ||
    input.pendingMigrations.length > 0 ||
    differsBeyondTableId
  );
}

function structureDiffersBeyondTableId(
  input: TableStructureInput,
  pendingHistory: PendingSchemaHistory,
  changedPointers: readonly JsonPointer[],
): boolean {
  return (
    input.pendingMigrations.some(({ changeType }) => changeType !== 'rename') ||
    historyDiffersFromHead(pendingHistory) ||
    !schemasEqual(input.head.schema, input.draft.schema) ||
    changedPointers.length > 0
  );
}

class LeafComparison {
  public readonly unchanged: readonly SchemaLeaf[];

  private readonly headLeaves: SchemaLeaves;
  private readonly draftLeaves: SchemaLeaves;

  constructor(
    private readonly head: TableSide,
    private readonly draft: TableSide,
    private readonly pendingPatchPointers: readonly JsonPointer[],
  ) {
    this.headLeaves = SchemaLeaves.of(head.schema);
    this.draftLeaves = SchemaLeaves.of(draft.schema);
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

  public changedLeaves(pendingEffects: readonly PatchEffect[]): ChangedLeaf[] {
    const origins = new NodeOrigins(this.headLeaves.all, pendingEffects);
    const draftLeaves = this.draftLeaves.all.map(
      (leaf): TracedLeaf => ({ leaf, origin: origins.at(leaf.pointer) }),
    );
    const movedAway = new Set(
      draftLeaves.filter(isMoved).map(({ origin }) => pointerKey(origin.node)),
    );

    return [
      ...draftLeaves.flatMap((draftLeaf) =>
        this.changesOfDraftLeaf(draftLeaf, movedAway),
      ),
      ...this.removedLeaves(movedAway),
    ];
  }

  public annotatedObjects(
    pendingEffects: readonly PatchEffect[],
  ): AnnotatedObject[] {
    const origins = new NodeOrigins(
      nestedObjectsOf(this.head.schema),
      pendingEffects,
    );

    return nestedObjectsOf(this.draft.schema).flatMap((draftObject) =>
      annotatedObjectOf(draftObject, origins.at(draftObject.pointer)),
    );
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

  private changesOfDraftLeaf(
    draftLeaf: TracedLeaf,
    movedAway: ReadonlySet<string>,
  ): ChangedLeaf[] {
    const { leaf, origin } = draftLeaf;

    if (!origin) {
      return [
        {
          pointer: leaf.pointer,
          change: this.changeOfNewLeaf(leaf, movedAway),
        },
      ];
    }

    if (isMoved(draftLeaf)) {
      return [this.movedLeafOf(draftLeaf)];
    }

    if (this.keepsValue(origin, leaf)) {
      return [];
    }

    return this.changesAtItsPointer(origin, leaf);
  }

  private changesAtItsPointer(
    origin: LeafOrigin,
    draftLeaf: SchemaLeaf,
  ): ChangedLeaf[] {
    if (!origin.rewritten && this.validateAlike(origin.node, draftLeaf)) {
      return this.annotatedLeafOf(origin.node, draftLeaf);
    }

    return [{ pointer: draftLeaf.pointer, change: 'changed' }];
  }

  private annotatedLeafOf(
    headLeaf: SchemaLeaf,
    draftLeaf: SchemaLeaf,
  ): ChangedLeaf[] {
    const annotations = this.differingAnnotations(headLeaf, draftLeaf);

    if (annotations.length === 0) {
      return [];
    }

    return [{ pointer: draftLeaf.pointer, change: 'annotated', annotations }];
  }

  private changeOfNewLeaf(
    leaf: SchemaLeaf,
    movedAway: ReadonlySet<string>,
  ): StructureFieldChange {
    if (!this.headLeaves.at(leaf.pointer) || movedAway.has(pointerKey(leaf))) {
      return 'added';
    }

    return 'changed';
  }

  private movedLeafOf({ leaf, origin }: MovedLeaf): ChangedLeaf {
    return {
      pointer: leaf.pointer,
      change: this.keepsValue(origin, leaf) ? 'moved' : 'changed',
      from: origin.node.pointer,
    };
  }

  private removedLeaves(movedAway: ReadonlySet<string>): ChangedLeaf[] {
    return this.headLeaves.all
      .filter(
        (leaf) =>
          !this.draftLeaves.at(leaf.pointer) &&
          !movedAway.has(pointerKey(leaf)),
      )
      .map(({ pointer }) => ({ pointer, change: 'removed' }));
  }

  private keepsValue(origin: LeafOrigin, draftLeaf: SchemaLeaf): boolean {
    return (
      !origin.rewritten &&
      !origin.annotated &&
      this.haveEqualSchemas(origin.node, draftLeaf)
    );
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
      normalizedLeafSchema(headLeaf.schema, this.head.tableIdentities),
      normalizedLeafSchema(draftLeaf.schema, this.draft.tableIdentities),
    );
  }

  private validateAlike(headLeaf: SchemaLeaf, draftLeaf: SchemaLeaf): boolean {
    return deepEqual(
      validatingLeafSchema(headLeaf.schema, this.head.tableIdentities),
      validatingLeafSchema(draftLeaf.schema, this.draft.tableIdentities),
    );
  }

  private differingAnnotations(
    headLeaf: SchemaLeaf,
    draftLeaf: SchemaLeaf,
  ): AnnotationKeyword[] {
    return ANNOTATION_KEYWORDS.filter(
      (annotation) =>
        !deepEqual(
          leafSchemaWithAnnotation(
            headLeaf.schema,
            annotation,
            this.head.tableIdentities,
          ),
          leafSchemaWithAnnotation(
            draftLeaf.schema,
            annotation,
            this.draft.tableIdentities,
          ),
        ),
    );
  }

  private isTouchedByPendingPatch(leaf: SchemaLeaf): boolean {
    return this.pendingPatchPointers.some((pointer) =>
      pointer.isAtOrAbove(leaf.pointer),
    );
  }
}

interface TracedLeaf {
  readonly leaf: SchemaLeaf;
  readonly origin?: LeafOrigin;
}

interface MovedLeaf extends TracedLeaf {
  readonly origin: LeafOrigin;
}

function isMoved(draftLeaf: TracedLeaf): draftLeaf is MovedLeaf {
  const { leaf, origin } = draftLeaf;

  return origin !== undefined && pointerKey(origin.node) !== pointerKey(leaf);
}

function annotatedObjectOf(
  draftObject: SchemaNode,
  origin: NodeOrigin<SchemaNode> | undefined,
): AnnotatedObject[] {
  if (!origin || !isPatchedInPlace(origin, draftObject)) {
    return [];
  }

  const annotations = ownAnnotationsDifferingBetween(
    origin.node.schema,
    draftObject.schema,
  );

  if (annotations.length === 0) {
    return [];
  }

  return [{ pointer: draftObject.pointer, annotations }];
}

function isPatchedInPlace(
  origin: NodeOrigin<SchemaNode>,
  draftNode: SchemaNode,
): boolean {
  return (
    (origin.annotated || origin.rewritten) &&
    pointerKey(origin.node) === pointerKey(draftNode)
  );
}

function pendingPatchPointers(
  pendingBatches: readonly JsonPatch[][],
  pendingEffects: readonly PatchEffect[] | undefined,
): JsonPointer[] {
  if (pendingEffects === undefined) {
    return pointersOfPatchPaths(pendingBatches.flat());
  }

  return pendingEffects.flatMap(pointersTouchedBy);
}

function pointersOfPatchPaths(patches: readonly JsonPatch[]): JsonPointer[] {
  return patches
    .flatMap(schemaPathsOf)
    .map((schemaPath) => dataPointerOfSchemaPath(schemaPath));
}

function patchBatchOf(migration: Migration): JsonPatch[][] {
  if (migration.changeType !== 'update') {
    return [];
  }

  return [migration.patches];
}

function schemaPathsOf(patch: JsonPatch): string[] {
  if (patch.op === 'move') {
    return [patch.from, patch.path];
  }

  return [patch.path];
}

function pointerKey(node: SchemaNode): string {
  return node.pointer.toString();
}
