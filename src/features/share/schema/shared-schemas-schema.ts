import { Schema } from 'ajv/dist/2020';

export const sharedSchemasSchema: Schema = {
  $id: 'shared-schemas-schema.json',
  type: 'object',
  $dynamicAnchor: 'meta',
  oneOf: [{ $ref: 'meta-schema.json' }],
};
