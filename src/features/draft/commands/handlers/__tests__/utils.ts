import {
  getNumberSchema,
  getObjectSchema,
  getStringSchema,
  getRefSchema,
} from '@revisium/schema-toolkit/mocks';
import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import {
  JsonObjectSchema,
  JsonSchemaTypeName,
} from '@revisium/schema-toolkit/types';
import { createDraftTestKit } from 'src/__tests__/kit/create-draft-test-kit';

export const testSchema: JsonObjectSchema = getObjectSchema({
  ver: getNumberSchema(),
});

export const testSchemaString: JsonObjectSchema = getObjectSchema({
  ver: getStringSchema(),
});

export const testSchemaWithRef: JsonObjectSchema = getObjectSchema({
  ver: getNumberSchema(),
  file: getRefSchema(SystemSchemaIds.File),
});

export const invalidTestSchema: JsonObjectSchema = {
  type: JsonSchemaTypeName.Object,
  required: ['123', '$ver'],
  properties: {
    '123': { type: JsonSchemaTypeName.String, default: '' },
    $ver: { type: JsonSchemaTypeName.Number, default: 0 },
  },
  additionalProperties: false,
};

export const getTestLinkedSchema = (
  foreignKeyTableId: string,
): JsonObjectSchema => ({
  type: JsonSchemaTypeName.Object,
  required: ['link'],
  properties: {
    link: {
      type: JsonSchemaTypeName.String,
      default: '',
      foreignKey: foreignKeyTableId,
    },
  },
  additionalProperties: false,
});

export const createTestingModule = createDraftTestKit;
