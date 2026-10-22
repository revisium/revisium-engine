import { Injectable } from '@nestjs/common';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import {
  readAt,
  toSegments,
  writeAt,
} from 'src/features/partial-changes-poc/catalogue/json-pointer';
import { RowVersion } from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import { calculateFormulaData } from 'src/features/plugin/formula/formula-calculation';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';

export interface MergedRowData {
  id: string;
  data: Record<string, unknown>;
  hash: string;
}

@Injectable()
export class RowMerger {
  private readonly plainSchemas = new WeakMap<object, JsonSchema>();

  constructor(private readonly jsonSchemaStore: JsonSchemaStoreService) {}

  merge(args: {
    schema: JsonSchema;
    base: RowVersion;
    other: RowVersion;
    paths: readonly string[];
    takeOtherId: boolean;
  }): MergedRowData {
    const data = structuredClone(args.base.data) as Record<string, unknown>;

    for (const path of args.paths) {
      const segments = toSegments(path);
      writeAt(
        data,
        segments,
        structuredClone(readAt(args.other.data, segments)),
      );
    }

    const computed = calculateFormulaData(this.plainSchema(args.schema), data);

    return {
      id: args.takeOtherId ? args.other.id : args.base.id,
      data: computed.data,
      hash: objectHash(computed.data),
    };
  }

  private plainSchema(schema: JsonSchema): JsonSchema {
    const cached = this.plainSchemas.get(schema);
    if (cached) {
      return cached;
    }

    const plain = this.jsonSchemaStore.create(schema).getPlainSchema();
    this.plainSchemas.set(schema, plain);
    return plain;
  }
}
