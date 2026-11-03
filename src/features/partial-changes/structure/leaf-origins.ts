import type { JsonPatch, JsonSchema } from '@revisium/schema-toolkit/types';
import type { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';
import {
  type DataTarget,
  dataTargetOfSchemaPath,
  type SchemaLeaf,
} from 'src/features/partial-changes/structure/schema-leaves';
import type { NativeSchemaRules } from 'src/features/share/ledger-replay/native-schema-rules';

export interface SchemaPatch {
  readonly patch: JsonPatch;
  readonly schema: JsonSchema;
}

export interface LeafOrigin {
  readonly leaf: SchemaLeaf;
  readonly rewritten: boolean;
}

interface TracedValue extends LeafOrigin {
  readonly pointer: JsonPointer;
}

interface Carry {
  readonly kind: 'carry';
  readonly from: JsonPointer;
  readonly to: JsonPointer;
}

type PatchEffect =
  | Carry
  | { readonly kind: 'rewrite'; readonly at: JsonPointer }
  | { readonly kind: 'end'; readonly at: JsonPointer };

export function schemaPatchesFrom(
  schema: JsonSchema,
  patches: readonly JsonPatch[],
  rules: NativeSchemaRules,
): SchemaPatch[] {
  const schemaPatches: SchemaPatch[] = [];
  let current = schema;

  for (const patch of patches) {
    schemaPatches.push({ patch, schema: current });
    current = schemaAfter(current, patch, rules);
  }

  return schemaPatches;
}

export class LeafOrigins {
  private readonly originsByPointer: ReadonlyMap<string, LeafOrigin>;

  constructor(
    headLeaves: readonly SchemaLeaf[],
    patches: readonly SchemaPatch[],
  ) {
    const values = patches
      .flatMap(effectsOf)
      .reduce(
        (traced, effect) =>
          traced.flatMap((value) => valueAfter(value, effect)),
        headLeaves.map(valueAtItsLeaf),
      );

    this.originsByPointer = new Map(
      values.map(({ pointer, leaf, rewritten }) => [
        pointer.toString(),
        { leaf, rewritten },
      ]),
    );
  }

  public at(pointer: JsonPointer): LeafOrigin | undefined {
    return this.originsByPointer.get(pointer.toString());
  }
}

function schemaAfter(
  schema: JsonSchema,
  patch: JsonPatch,
  rules: NativeSchemaRules,
): JsonSchema {
  try {
    return rules.patchedSchema(schema, [patch]);
  } catch {
    return schema;
  }
}

function valueAtItsLeaf(leaf: SchemaLeaf): TracedValue {
  return { leaf, pointer: leaf.pointer, rewritten: false };
}

function effectsOf({ patch, schema }: SchemaPatch): PatchEffect[] {
  const targetOf = (schemaPath: string) =>
    dataTargetOfSchemaPath(schema, schemaPath);

  if (patch.op === 'replace') {
    return [{ kind: 'rewrite', at: targetOf(patch.path).pointer }];
  }

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

function valueAfter(value: TracedValue, effect: PatchEffect): TracedValue[] {
  if (effect.kind === 'carry') {
    return carriedValue(value, effect);
  }

  if (!effect.at.isAtOrAbove(value.pointer)) {
    return [value];
  }

  if (effect.kind === 'rewrite') {
    return [{ ...value, rewritten: true }];
  }

  return [];
}

function carriedValue(value: TracedValue, { from, to }: Carry): TracedValue[] {
  if (from.isAtOrAbove(value.pointer)) {
    return [{ ...value, pointer: value.pointer.relocated(from, to) }];
  }

  if (to.isAtOrAbove(value.pointer)) {
    return [];
  }

  return [value];
}
