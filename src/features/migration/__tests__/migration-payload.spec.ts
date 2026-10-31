import {
  JsonSchemaTypeName,
  type JsonPatch,
} from '@revisium/schema-toolkit/types';
import {
  decodeMigrationPayload,
  encodeMigrationPayload,
} from 'src/features/migration/migration-payload';

const patches: JsonPatch[] = [
  {
    op: 'add',
    path: '/properties/price',
    value: { type: JsonSchemaTypeName.Number, default: 0 },
  },
];

describe('Migration payload', () => {
  it('decodes a legacy patch array as version 1', () => {
    expect(decodeMigrationPayload(patches)).toEqual({ version: 1, patches });
  });

  it('decodes the envelope the start writes as version 2', () => {
    expect(decodeMigrationPayload(encodeMigrationPayload(patches))).toEqual({
      version: 2,
      patches,
    });
  });

  it('decodes the source migration id of an imported envelope', () => {
    expect(
      decodeMigrationPayload({
        version: 2,
        patches,
        ledgerMigrationId: '2026-10-31T00:00:00.000Z',
      }),
    ).toEqual({
      version: 2,
      patches,
      ledgerMigrationId: '2026-10-31T00:00:00.000Z',
    });
  });

  it.each([
    ['an unknown version', { version: 3, patches }],
    ['an envelope without patches', { version: 2 }],
    [
      'an envelope with a non-string source id',
      { version: 2, patches, ledgerMigrationId: 1 },
    ],
    ['a scalar', 'patches'],
    ['null', null],
  ])('refuses %s as PAYLOAD_UNSUPPORTED', (_, payload) => {
    expect(() => decodeMigrationPayload(payload)).toThrow(
      /^PAYLOAD_UNSUPPORTED: /,
    );
  });
});
