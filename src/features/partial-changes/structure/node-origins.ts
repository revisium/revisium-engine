import { deepEqual } from '@revisium/schema-toolkit/lib';
import type {
  JsonPatch,
  JsonPatchReplace,
  JsonSchema,
} from '@revisium/schema-toolkit/types';
import type { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';
import { validatingSchema } from 'src/features/partial-changes/structure/normalized-leaf-schema';
import {
  type DataTarget,
  dataTargetOfSchemaPath,
  type SchemaNode,
} from 'src/features/partial-changes/structure/schema-leaves';
import type {
  NativeSchemaRules,
  NativeSchemaStore,
} from 'src/features/share/ledger-replay/native-schema-rules';

export interface NodeOrigin<TNode extends SchemaNode> {
  readonly node: TNode;
  readonly rewritten: boolean;
  readonly annotated: boolean;
}

interface TracedValue<TNode extends SchemaNode> extends NodeOrigin<TNode> {
  readonly pointer: JsonPointer;
}

interface Carry {
  readonly kind: 'carry';
  readonly from: JsonPointer;
  readonly to: JsonPointer;
}

export type PatchEffect =
  | Carry
  | { readonly kind: 'rewrite'; readonly at: JsonPointer }
  | { readonly kind: 'annotate'; readonly at: JsonPointer }
  | { readonly kind: 'end'; readonly at: JsonPointer };

export interface ReplayTables {
  readonly head: ReadonlyMap<string, string>;
  readonly draft: ReadonlyMap<string, string>;
}

interface ReplacementTables {
  readonly replaced: ReadonlyMap<string, string>;
  readonly replacement: ReadonlyMap<string, string>;
}

interface HeldNode {
  readonly schema: JsonSchema;
  readonly held: JsonSchema;
}

export function replayPendingPatches(
  headSchema: JsonSchema,
  pendingBatches: readonly (readonly JsonPatch[])[],
  rules: NativeSchemaRules,
  tables: ReplayTables,
): PatchEffect[] | undefined {
  try {
    return effectsOfBatches(
      headSchema,
      pendingBatches,
      rules,
      replacementTablesOf(tables),
    );
  } catch {
    return undefined;
  }
}

export function pointersTouchedBy(effect: PatchEffect): JsonPointer[] {
  if (effect.kind === 'carry') {
    return [effect.from, effect.to];
  }

  return [effect.at];
}

export class NodeOrigins<TNode extends SchemaNode> {
  private readonly originsByPointer: ReadonlyMap<string, NodeOrigin<TNode>>;

  constructor(headNodes: readonly TNode[], effects: readonly PatchEffect[]) {
    const values = effects.reduce(
      (traced, effect) => traced.flatMap((value) => valueAfter(value, effect)),
      headNodes.map(valueAtItsNode),
    );

    this.originsByPointer = new Map(
      values.map(({ pointer, ...origin }) => [pointer.toString(), origin]),
    );
  }

  public at(pointer: JsonPointer): NodeOrigin<TNode> | undefined {
    return this.originsByPointer.get(pointer.toString());
  }
}

function effectsOfBatches(
  headSchema: JsonSchema,
  batches: readonly (readonly JsonPatch[])[],
  rules: NativeSchemaRules,
  tables: ReplacementTables,
): PatchEffect[] {
  const effects: PatchEffect[] = [];
  let schema = headSchema;

  for (const batch of batches) {
    const store = rules.schemaStore(schema);
    effects.push(...effectsOfBatch(batch, store, tables));
    schema = store.schema();
  }

  return effects;
}

function effectsOfBatch(
  batch: readonly JsonPatch[],
  store: NativeSchemaStore,
  tables: ReplacementTables,
): PatchEffect[] {
  const effects: PatchEffect[] = [];

  for (const patch of batch) {
    effects.push(...effectsOfApplying(patch, store, tables));
  }

  return effects;
}

function effectsOfApplying(
  patch: JsonPatch,
  store: NativeSchemaStore,
  tables: ReplacementTables,
): PatchEffect[] {
  if (patch.op === 'replace') {
    return [effectOfReplacing(patch, store, tables)];
  }

  const effects = effectsOfAddRemoveOrMove(patch, store);
  store.applyPatch(patch);

  return effects;
}

function effectOfReplacing(
  patch: JsonPatchReplace,
  store: NativeSchemaStore,
  tables: ReplacementTables,
): PatchEffect {
  const { pointer, isNode } = dataTargetOfSchemaPath(store, patch.path);
  const replaced = isNode ? heldNodeAt(store, pointer) : undefined;

  store.applyPatch(patch);

  if (
    replaced &&
    changesOnlyAnnotations(
      replaced,
      heldNodeAt(store, pointer),
      patch.value,
      tables,
    )
  ) {
    return { kind: 'annotate', at: pointer };
  }

  return { kind: 'rewrite', at: pointer };
}

function changesOnlyAnnotations(
  replaced: HeldNode,
  replacement: HeldNode | undefined,
  value: JsonSchema,
  tables: ReplacementTables,
): boolean {
  if (!replacement || deepEqual(replaced.schema, value)) {
    return false;
  }

  return (
    deepEqual(
      validatingSchema(replaced.schema, tables.replaced),
      validatingSchema(replacement.schema, tables.replacement),
    ) &&
    deepEqual(
      validatingSchema(replaced.held, tables.replaced),
      validatingSchema(replacement.held, tables.replacement),
    )
  );
}

function heldNodeAt(
  store: NativeSchemaStore,
  pointer: JsonPointer,
): HeldNode | undefined {
  const schema = store.schemaAt(pointer.segments);
  const held = store.heldSchemaAt(pointer.segments);

  if (!schema || !held) {
    return undefined;
  }

  return { schema, held };
}

function replacementTablesOf({ head, draft }: ReplayTables): ReplacementTables {
  return {
    replaced: new Map([...draft, ...head]),
    replacement: new Map([...head, ...draft]),
  };
}

function effectsOfAddRemoveOrMove(
  patch: Exclude<JsonPatch, JsonPatchReplace>,
  store: NativeSchemaStore,
): PatchEffect[] {
  const targetOf = (schemaPath: string) =>
    dataTargetOfSchemaPath(store, schemaPath);

  if (patch.op === 'move') {
    return effectsOfMove(targetOf(patch.from), targetOf(patch.path));
  }

  return [effectOfAddOrRemoveAt(targetOf(patch.path))];
}

function effectsOfMove(source: DataTarget, target: DataTarget): PatchEffect[] {
  if (source.isNode && target.isNode) {
    return [{ kind: 'carry', from: source.pointer, to: target.pointer }];
  }

  return [effectOfAddOrRemoveAt(source), effectOfAddOrRemoveAt(target)];
}

function effectOfAddOrRemoveAt({ pointer, isNode }: DataTarget): PatchEffect {
  if (!isNode) {
    return { kind: 'rewrite', at: pointer };
  }

  return { kind: 'end', at: pointer };
}

function valueAtItsNode<TNode extends SchemaNode>(
  node: TNode,
): TracedValue<TNode> {
  return { node, pointer: node.pointer, rewritten: false, annotated: false };
}

function valueAfter<TNode extends SchemaNode>(
  value: TracedValue<TNode>,
  effect: PatchEffect,
): TracedValue<TNode>[] {
  if (effect.kind === 'carry') {
    return carriedValue(value, effect);
  }

  if (!effect.at.isAtOrAbove(value.pointer)) {
    return [value];
  }

  if (effect.kind === 'rewrite') {
    return [{ ...value, rewritten: true }];
  }

  if (effect.kind === 'annotate') {
    return [{ ...value, annotated: true }];
  }

  return [];
}

function carriedValue<TNode extends SchemaNode>(
  value: TracedValue<TNode>,
  { from, to }: Carry,
): TracedValue<TNode>[] {
  if (from.isAtOrAbove(value.pointer)) {
    return [{ ...value, pointer: value.pointer.relocated(from, to) }];
  }

  if (to.isAtOrAbove(value.pointer)) {
    return [];
  }

  return [value];
}
