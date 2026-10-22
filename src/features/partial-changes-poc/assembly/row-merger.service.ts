import { Injectable } from '@nestjs/common';
import { SchemaTable } from '@revisium/schema-toolkit/lib';
import { generateDefaultValue } from '@revisium/schema-toolkit/model';
import type { JsonSchema, JsonValue } from '@revisium/schema-toolkit/types';
import objectHash from 'object-hash';
import type { Row } from 'src/engine-prisma-types';
import {
  readAt,
  toSegments,
  writeAt,
} from 'src/features/partial-changes-poc/catalogue/json-pointer';
import type { SchemaLeaf } from 'src/features/partial-changes-poc/catalogue/schema-leaves';
import { RowVersion } from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import { calculateFormulaData } from 'src/features/plugin/formula/formula-calculation';
import { PluginService } from 'src/features/plugin/plugin.service';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import type { HistoryPatches } from 'src/features/share/queries/impl';

export interface MergedRowData {
  id: string;
  data: Record<string, unknown>;
  hash: string;
}

export interface ConversionContext {
  revisionId: string;
  tableId: string;
  targetSchema: JsonSchema;
}

@Injectable()
export class RowMerger {
  private readonly plainSchemas = new WeakMap<object, JsonSchema>();

  constructor(
    private readonly jsonSchemaStore: JsonSchemaStoreService,
    private readonly pluginService: PluginService,
  ) {}

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

  async migrateToDraftStructure(
    head: RowVersion,
    history: readonly HistoryPatches[],
    headSchema: JsonSchema,
    context: ConversionContext,
  ): Promise<MergedRowData> {
    const table = new SchemaTable(
      structuredClone(headSchema),
      this.jsonSchemaStore.refs,
    );
    table.addRow(head.id, structuredClone(head.data) as JsonValue);
    for (const entry of history) {
      table.applyPatches(structuredClone(entry.patches));
    }
    return this.afterMigration(head.id, table.getRow(head.id), context);
  }

  async mapToHeadStructure(
    draft: RowVersion,
    unchangedLeaves: readonly SchemaLeaf[],
    context: ConversionContext,
  ): Promise<MergedRowData> {
    const data = generateDefaultValue(context.targetSchema, {
      refSchemas: { ...this.jsonSchemaStore.refs },
    }) as Record<string, unknown>;

    for (const leaf of unchangedLeaves) {
      if (leaf.kind !== 'computed') {
        writeAt(
          data,
          leaf.segments,
          structuredClone(readAt(draft.data, leaf.segments)),
        );
      }
    }

    return this.afterMigration(draft.id, data as JsonValue, context);
  }

  private async afterMigration(
    id: string,
    data: JsonValue,
    context: ConversionContext,
  ): Promise<MergedRowData> {
    const row = { id, data } as unknown as Row;
    await this.pluginService.afterMigrateRows({
      revisionId: context.revisionId,
      tableId: context.tableId,
      rows: [row],
      targetSchema: context.targetSchema,
    });
    const migrated = row.data as Record<string, unknown>;
    return { id, data: migrated, hash: objectHash(migrated) };
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
