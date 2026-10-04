import { JsonSchema } from '@revisium/schema-toolkit/types';
import { SubSchemaPath } from '@revisium/prisma-pg-json';
import {
  createJsonSchemaStore,
  traverseStore,
  convertSchemaPathToJsonPath,
  getPathByStore,
  pluginRefs,
} from '@revisium/schema-toolkit/lib';

export function findRefPaths(
  schema: JsonSchema,
  schemaId: string,
): SubSchemaPath[] {
  const paths: SubSchemaPath[] = [];
  const store = createJsonSchemaStore(schema, pluginRefs);

  traverseStore(store, (node) => {
    if (node.$ref === schemaId) {
      const fieldPath = convertSchemaPathToJsonPath(getPathByStore(node));
      const path =
        !fieldPath || fieldPath.startsWith('[*]') ? `$${fieldPath}` : fieldPath;
      paths.push({ path });
    }
  });

  return paths;
}
