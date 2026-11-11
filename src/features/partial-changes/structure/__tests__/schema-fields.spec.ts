import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { arr, num, obj, ref, str } from '@revisium/schema-toolkit/mocks';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import { hasFileFields } from '../schema-fields';

describe('hasFileFields', () => {
  it.each<{ fields: string; schema: JsonSchema; expected: boolean }>([
    {
      fields: 'a File field',
      schema: obj({ title: str(), image: ref(SystemSchemaIds.File) }),
      expected: true,
    },
    {
      fields: 'File items of an array',
      schema: obj({ images: arr(ref(SystemSchemaIds.File)) }),
      expected: true,
    },
    {
      fields: 'a File field inside a nested object',
      schema: obj({ cover: obj({ image: ref(SystemSchemaIds.File) }) }),
      expected: true,
    },
    {
      fields: 'a File field inside an array of objects',
      schema: obj({
        gallery: arr(obj({ caption: str(), image: ref(SystemSchemaIds.File) })),
      }),
      expected: true,
    },
    {
      fields: 'no File field',
      schema: obj({
        title: str(),
        tags: arr(str()),
        size: obj({ width: num() }),
      }),
      expected: false,
    },
  ])('finds $fields: $expected', ({ schema, expected }) => {
    expect(hasFileFields(schema)).toBe(expected);
  });
});
