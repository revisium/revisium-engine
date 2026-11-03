import type { JsonPatch, JsonPatchMove } from '@revisium/schema-toolkit/types';
import type { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';
import {
  dataNodeOfSchemaPath,
  dataPointerOfSchemaPath,
  type SchemaLeaf,
} from 'src/features/partial-changes/structure/schema-leaves';

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

export class LeafOrigins {
  private readonly originsByPointer: ReadonlyMap<string, LeafOrigin>;

  constructor(
    headLeaves: readonly SchemaLeaf[],
    patches: readonly JsonPatch[],
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

function valueAtItsLeaf(leaf: SchemaLeaf): TracedValue {
  return { leaf, pointer: leaf.pointer, rewritten: false };
}

function effectsOf(patch: JsonPatch): PatchEffect[] {
  if (patch.op === 'replace') {
    return [{ kind: 'rewrite', at: dataPointerOfSchemaPath(patch.path) }];
  }

  if (patch.op === 'move') {
    return effectsOfMove(patch);
  }

  return [effectOfAddOrRemoveAt(patch.path)];
}

function effectsOfMove({ from, path }: JsonPatchMove): PatchEffect[] {
  const source = dataNodeOfSchemaPath(from);
  const target = dataNodeOfSchemaPath(path);

  if (source && target) {
    return [{ kind: 'carry', from: source, to: target }];
  }

  return [effectOfAddOrRemoveAt(from), effectOfAddOrRemoveAt(path)];
}

function effectOfAddOrRemoveAt(schemaPath: string): PatchEffect {
  const node = dataNodeOfSchemaPath(schemaPath);

  if (!node) {
    return { kind: 'rewrite', at: dataPointerOfSchemaPath(schemaPath) };
  }

  return { kind: 'end', at: node };
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
