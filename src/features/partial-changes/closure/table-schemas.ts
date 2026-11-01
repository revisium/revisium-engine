import {
  getDBJsonPathByJsonSchemaStore,
  getForeignKeysFromSchema,
  getPathByStore,
  traverseStore,
} from '@revisium/schema-toolkit/lib';
import type { JsonSchemaStore } from '@revisium/schema-toolkit/model';
import {
  type JsonSchema,
  JsonSchemaTypeName,
} from '@revisium/schema-toolkit/types';
import type { TableVersion } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';
import { dataPointerOfSchemaPath } from 'src/features/partial-changes/structure/schema-leaves';
import type { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';

export interface ForeignKeyLeaf {
  readonly jsonPath: string;
  readonly pointer: JsonPointer;
}

export class TableSchemas {
  private readonly stores = new Map<JsonSchema, JsonSchemaStore>();

  constructor(private readonly schemaStore: JsonSchemaStoreService) {}

  public storeOf({ schema }: TableVersion): JsonSchemaStore {
    const cached = this.stores.get(schema);

    if (cached) {
      return cached;
    }

    const store = this.schemaStore.create(schema);
    this.stores.set(schema, store);

    return store;
  }

  public referencedTablesOf(version: TableVersion): string[] {
    return getForeignKeysFromSchema(this.storeOf(version));
  }

  public foreignKeyLeavesOf(
    version: TableVersion,
    tableId: string,
  ): ForeignKeyLeaf[] {
    const leaves: ForeignKeyLeaf[] = [];

    traverseStore(this.storeOf(version), (item) => {
      if (
        item.type === JsonSchemaTypeName.String &&
        item.foreignKey === tableId
      ) {
        leaves.push({
          jsonPath: getDBJsonPathByJsonSchemaStore(item),
          pointer: dataPointerOfSchemaPath(getPathByStore(item)),
        });
      }
    });

    return leaves;
  }
}
