import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import {
  type JsonSchema,
  JsonSchemaTypeName,
} from '@revisium/schema-toolkit/types';
import { CustomSchemeKeywords } from 'src/features/share/schema/consts';

type FieldPredicate = (node: JsonSchema) => boolean;

export function hasFileFields(schema: JsonSchema): boolean {
  return hasFieldWhere(schema, isFileField);
}

export function hasFormulaOrFileFields(schema: JsonSchema): boolean {
  return hasFieldWhere(
    schema,
    (node) => isFileField(node) || isFormulaField(node),
  );
}

function hasFieldWhere(node: JsonSchema, matches: FieldPredicate): boolean {
  if (matches(node)) {
    return true;
  }

  if ('$ref' in node) {
    return false;
  }

  if (node.type === JsonSchemaTypeName.Array) {
    return hasFieldWhere(node.items, matches);
  }

  if (node.type === JsonSchemaTypeName.Object) {
    return Object.values(node.properties).some((child) =>
      hasFieldWhere(child, matches),
    );
  }

  return false;
}

function isFileField(node: JsonSchema): boolean {
  return '$ref' in node && node.$ref === SystemSchemaIds.File;
}

function isFormulaField(node: JsonSchema): boolean {
  return !('$ref' in node) && CustomSchemeKeywords.XFormula in node;
}
