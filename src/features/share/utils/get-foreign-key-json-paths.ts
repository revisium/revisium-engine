import {
  getDBJsonPathByJsonSchemaStore,
  traverseStore,
} from '@revisium/schema-toolkit/lib';
import { JsonSchemaStore } from '@revisium/schema-toolkit/model';
import { JsonSchemaTypeName } from '@revisium/schema-toolkit/types';

export function getForeignKeyJsonPaths(
  schemaStore: JsonSchemaStore,
  targetTableId: string,
): string[] {
  const paths: string[] = [];

  traverseStore(schemaStore, (item) => {
    if (
      item.type === JsonSchemaTypeName.String &&
      item.foreignKey === targetTableId
    ) {
      paths.push(getDBJsonPathByJsonSchemaStore(item));
    }
  });

  return paths;
}
