import { Injectable } from '@nestjs/common';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { JsonValue, Row } from 'src/engine-prisma-types';
import type {
  OtherSideColumn,
  OtherSideParts,
} from 'src/features/partial-changes/assembly/outcome-rules';
import { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';
import { PluginService } from 'src/features/plugin/plugin.service';
import { JsonSchemaValidatorService } from 'src/features/share/json-schema-validator.service';
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

@Injectable()
export class RowMerger {
  constructor(
    private readonly pluginService: PluginService,
    private readonly hashService: HashService,
    private readonly schemaValidator: JsonSchemaValidatorService,
  ) {}

  public async merge(
    merges: readonly RowMerge[],
    target: MergeTarget,
  ): Promise<MergedRow[]> {
    if (merges.length === 0) {
      return [];
    }

    const rows = merges.map(rowTakingOtherSideParts);
    await this.recomputeComputedLeaves(rows, target);
    const schemaHash = this.schemaValidator.getSchemaHash(target.schema);

    return Promise.all(rows.map((row) => this.mergedRowOf(row, schemaHash)));
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
  const data = structuredClone(structureSide.data);

  for (const path of fromOtherSide.paths) {
    const pointer = JsonPointer.parse(path);
    pointer.assignIn(data, structuredClone(pointer.valueIn(otherSide.data)));
  }

  return data;
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
