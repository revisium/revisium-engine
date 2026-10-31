import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import {
  arr,
  bool,
  num,
  numFormula,
  obj,
  ref,
  str,
  strFormula,
} from '@revisium/schema-toolkit/mocks';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';
import {
  dataPointerOfSchemaPath,
  type LeafKind,
  SchemaLeaves,
} from 'src/features/partial-changes/structure/schema-leaves';

const publishedAt = () => ref(SystemSchemaIds.RowPublishedAt);

describe('SchemaLeaves', () => {
  it('walks object properties down to the leaves', () => {
    const leaves = SchemaLeaves.of(
      obj({
        code: str(),
        address: obj({ city: str(), geo: obj({ lat: num(), lng: num() }) }),
      }),
    );

    expect(pointersOf(leaves)).toEqual([
      '/code',
      '/address/city',
      '/address/geo/lat',
      '/address/geo/lng',
    ]);
  });

  it('keeps an array and a File as one leaf each', () => {
    const leaves = SchemaLeaves.of(
      obj({
        tags: arr(obj({ name: str(), weight: num() })),
        cover: ref(SystemSchemaIds.File),
      }),
    );

    expect(pointersOf(leaves)).toEqual(['/tags', '/cover']);
  });

  it.each<{ name: string; schema: JsonSchema; kind: LeafKind }>([
    { name: 'a string', schema: str(), kind: 'value' },
    { name: 'a number', schema: num(), kind: 'value' },
    { name: 'a boolean', schema: bool(), kind: 'value' },
    {
      name: 'a foreign key',
      schema: str({ foreignKey: 'categories' }),
      kind: 'value',
    },
    { name: 'an array', schema: arr(num()), kind: 'atomic' },
    { name: 'a File', schema: ref(SystemSchemaIds.File), kind: 'atomic' },
    {
      name: 'the only RowPublishedAt',
      schema: publishedAt(),
      kind: 'publishedAt',
    },
    { name: 'a number formula', schema: numFormula('1 + 1'), kind: 'computed' },
    { name: 'a string formula', schema: strFormula('"a"'), kind: 'computed' },
    { name: 'a row id', schema: ref(SystemSchemaIds.RowId), kind: 'computed' },
    {
      name: 'a row created id',
      schema: ref(SystemSchemaIds.RowCreatedId),
      kind: 'computed',
    },
    {
      name: 'a row version id',
      schema: ref(SystemSchemaIds.RowVersionId),
      kind: 'computed',
    },
    {
      name: 'a row created at',
      schema: ref(SystemSchemaIds.RowCreatedAt),
      kind: 'computed',
    },
    {
      name: 'a row updated at',
      schema: ref(SystemSchemaIds.RowUpdatedAt),
      kind: 'computed',
    },
    {
      name: 'a row hash',
      schema: ref(SystemSchemaIds.RowHash),
      kind: 'computed',
    },
    {
      name: 'a row schema hash',
      schema: ref(SystemSchemaIds.RowSchemaHash),
      kind: 'computed',
    },
  ])('classifies $name as a $kind leaf', ({ schema, kind }) => {
    const leaves = SchemaLeaves.of(obj({ subject: schema }));

    expect(kindAt(leaves, '/subject')).toBe(kind);
  });

  describe('published-at field', () => {
    it('is the only RowPublishedAt of the schema, outside arrays', () => {
      const leaves = SchemaLeaves.of(
        obj({ code: str(), meta: obj({ releasedAt: publishedAt() }) }),
      );

      expect(leaves.publishedAtField()?.pointer.toString()).toBe(
        '/meta/releasedAt',
      );
    });

    it('does not exist when the schema has several RowPublishedAt leaves, each of them computed', () => {
      const leaves = SchemaLeaves.of(
        obj({ releasedAt: publishedAt(), reviewedAt: publishedAt() }),
      );

      expect(leaves.publishedAtField()).toBeUndefined();
      expect(kindAt(leaves, '/releasedAt')).toBe('computed');
      expect(kindAt(leaves, '/reviewedAt')).toBe('computed');
    });

    it('does not exist when the only RowPublishedAt is inside an array, which stays atomic', () => {
      const leaves = SchemaLeaves.of(
        obj({ releases: arr(obj({ at: publishedAt() })) }),
      );

      expect(leaves.publishedAtField()).toBeUndefined();
      expect(pointersOf(leaves)).toEqual(['/releases']);
      expect(kindAt(leaves, '/releases')).toBe('atomic');
    });

    it('does not exist when another RowPublishedAt is inside an array', () => {
      const leaves = SchemaLeaves.of(
        obj({
          releasedAt: publishedAt(),
          releases: arr(obj({ at: publishedAt() })),
        }),
      );

      expect(leaves.publishedAtField()).toBeUndefined();
      expect(kindAt(leaves, '/releasedAt')).toBe('computed');
    });
  });

  it.each([
    { schemaPath: '', dataPointer: '' },
    { schemaPath: '/properties/price', dataPointer: '/price' },
    {
      schemaPath: '/properties/address/properties/city',
      dataPointer: '/address/city',
    },
    { schemaPath: '/properties/tags/items', dataPointer: '/tags' },
    {
      schemaPath: '/properties/tags/items/properties/name',
      dataPointer: '/tags',
    },
    { schemaPath: '/properties/a~1b', dataPointer: '/a~1b' },
    { schemaPath: '/properties', dataPointer: '' },
  ])(
    'maps the schema path "$schemaPath" to the data pointer "$dataPointer"',
    ({ schemaPath, dataPointer }) => {
      expect(dataPointerOfSchemaPath(schemaPath).toString()).toBe(dataPointer);
    },
  );
});

function pointersOf(leaves: SchemaLeaves): string[] {
  return leaves.all.map((leaf) => leaf.pointer.toString());
}

function kindAt(leaves: SchemaLeaves, pointer: string): LeafKind | undefined {
  return leaves.at(JsonPointer.parse(pointer))?.kind;
}
