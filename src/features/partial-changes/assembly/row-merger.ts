import { Injectable } from '@nestjs/common';
import { SchemaTable } from '@revisium/schema-toolkit/lib';
import { generateDefaultValue } from '@revisium/schema-toolkit/model';
import type {
  JsonSchema,
  JsonValue as SchemaJsonValue,
} from '@revisium/schema-toolkit/types';
import type { JsonValue, Row } from 'src/engine-prisma-types';
import type {
  OtherSideColumn,
  OtherSideParts,
} from 'src/features/partial-changes/assembly/outcome-rules';
import { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';
import {
  type SchemaLeaf,
  storesValueInData,
} from 'src/features/partial-changes/structure/schema-leaves';
import { PluginService } from 'src/features/plugin/plugin.service';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
import type { HistoryPatches } from 'src/features/share/queries/impl';
import { HashService } from 'src/infrastructure/database/hash.service';

export type MergedRow = Pick<
  Row,
  | 'createdId'
  | 'createdAt'
  | 'id'
  | 'data'
  | 'hash'
  | 'schemaHash'
  | 'publishedAt'
  | 'meta'
>;

export interface RowMerge {
  readonly structureSide: Row;
  readonly otherSide: Row;
  readonly fromOtherSide: OtherSideParts;
}

export interface MergeTarget {
  readonly revisionId: string;
  readonly tableId: string;
  readonly schema: JsonSchema;
}

export interface DraftStructureMigration {
  readonly headSchema: JsonSchema;
  readonly pendingHistory: readonly HistoryPatches[];
}

@Injectable()
export class RowMerger {
  constructor(
    private readonly pluginService: PluginService,
    private readonly hashService: HashService,
    private readonly schemaValidator: JsonSchemaValidatorService,
    private readonly schemaStore: JsonSchemaStoreService,
  ) {}

  public merge(
    merges: readonly RowMerge[],
    target: MergeTarget,
  ): Promise<MergedRow[]> {
    return this.newVersionsOf(merges.map(rowTakingOtherSideParts), target);
  }

  public migrateIntoDraftStructure(
    headRows: readonly Row[],
    migration: DraftStructureMigration,
    target: MergeTarget,
  ): Promise<MergedRow[]> {
    return this.newVersionsOf(
      this.migratedThroughPendingHistory(headRows, migration),
      target,
    );
  }

  public mapIntoHeadStructure(
    draftRows: readonly Row[],
    unchangedLeaves: readonly SchemaLeaf[],
    target: MergeTarget,
  ): Promise<MergedRow[]> {
    return this.newVersionsOf(
      draftRows.map((row) =>
        this.withHeadDefaults(row, unchangedLeaves, target.schema),
      ),
      target,
    );
  }

  private async newVersionsOf(
    rows: Row[],
    target: MergeTarget,
  ): Promise<MergedRow[]> {
    if (rows.length === 0) {
      return [];
    }

    await this.recomputeComputedLeaves(rows, target);
    const schemaHash = this.schemaValidator.getSchemaHash(target.schema);

    return Promise.all(rows.map((row) => this.mergedRowOf(row, schemaHash)));
  }

  private migratedThroughPendingHistory(
    rows: readonly Row[],
    { headSchema, pendingHistory }: DraftStructureMigration,
  ): Row[] {
    let schema = headSchema;
    let migrated = [...rows];

    // As in native updateTable, every history entry patches a table of its own: the schema toolkit cannot patch a
    // field that an earlier entry moved in the same SchemaTable.
    for (const { patches } of pendingHistory) {
      const table = this.schemaTableOf(schema, migrated);

      table.applyPatches(patches);
      schema = table.getSchema();
      migrated = migrated.map((row) => ({
        ...row,
        data: table.getRow(row.id),
      }));
    }

    return migrated;
  }

  private schemaTableOf(schema: JsonSchema, rows: readonly Row[]): SchemaTable {
    const table = new SchemaTable(schema, this.schemaStore.refs);

    for (const row of rows) {
      table.addRow(row.id, row.data as SchemaJsonValue);
    }

    return table;
  }

  private withHeadDefaults(
    row: Row,
    unchangedLeaves: readonly SchemaLeaf[],
    headSchema: JsonSchema,
  ): Row {
    let data = generateDefaultValue(headSchema, {
      refSchemas: this.schemaStore.refs,
    });

    for (const { pointer } of unchangedLeaves.filter(storesValueInData)) {
      data = pointer.assignIn(data, structuredClone(pointer.valueIn(row.data)));
    }

    return { ...row, data: data as JsonValue };
  }

  private recomputeComputedLeaves(
    rows: Row[],
    target: MergeTarget,
  ): Promise<void> {
    return this.pluginService.afterMigrateRows({
      revisionId: target.revisionId,
      tableId: target.tableId,
      rows,
      targetSchema: target.schema,
    });
  }

  private async mergedRowOf(row: Row, schemaHash: string): Promise<MergedRow> {
    return {
      createdId: row.createdId,
      createdAt: row.createdAt,
      id: row.id,
      data: row.data,
      hash: await this.hashService.hashObject(row.data),
      schemaHash,
      publishedAt: row.publishedAt,
      meta: row.meta,
    };
  }
}

function rowTakingOtherSideParts(merge: RowMerge): Row {
  return {
    ...merge.structureSide,
    id: sideTaking(merge, merge.fromOtherSide.id).id,
    data: dataTakingOtherSidePaths(merge),
    publishedAt: sideTakingColumn(merge, 'publishedAt').publishedAt,
    meta: sideTakingColumn(merge, 'meta').meta,
  };
}

function dataTakingOtherSidePaths({
  structureSide,
  otherSide,
  fromOtherSide,
}: RowMerge): JsonValue {
  let data: unknown = structuredClone(structureSide.data);

  for (const path of fromOtherSide.paths) {
    const pointer = JsonPointer.parse(path);
    data = pointer.assignIn(
      data,
      structuredClone(pointer.valueIn(otherSide.data)),
    );
  }

  return data as JsonValue;
}

function sideTakingColumn(merge: RowMerge, column: OtherSideColumn): Row {
  return sideTaking(merge, merge.fromOtherSide.columns.includes(column));
}

function sideTaking(merge: RowMerge, takesOtherSide: boolean): Row {
  if (takesOtherSide) {
    return merge.otherSide;
  }

  return merge.structureSide;
}
