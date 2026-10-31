import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import {
  JsonSchemaTypeName,
  type JsonSchema,
} from '@revisium/schema-toolkit/types';
import { schemasEqual } from 'src/features/share/ledger-replay/schemas-equal';

describe('schemasEqual', () => {
  it('treats schemas that differ only in object key order as equal', () => {
    const storedInAnotherKeyOrder: JsonSchema = {
      properties: { price: { default: 0, type: JsonSchemaTypeName.Number } },
      required: ['price'],
      additionalProperties: false,
      type: JsonSchemaTypeName.Object,
    };

    expect(schemasEqual(obj({ price: num() }), storedInAnotherKeyOrder)).toBe(
      true,
    );
  });

  it('treats schemas with different fields as different', () => {
    expect(schemasEqual(obj({ price: num() }), obj({ price: str() }))).toBe(
      false,
    );
  });
});
