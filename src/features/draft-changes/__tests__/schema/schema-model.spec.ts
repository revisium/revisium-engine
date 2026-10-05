import objectHash from 'object-hash';
import { pluginRefs, SchemaTable } from '@revisium/schema-toolkit/lib';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { HistoryPatches } from 'src/features/share/queries/impl/transactional/get-table-schema.query';
import { validateSchemaHistory } from 'src/features/draft-changes/schema/schema-history';

describe('Draft Changes schema model exports', () => {
  it('validates persisted formula-bearing history after a schema move', () => {
    const initial: JsonSchema = {
      type: 'object',
      properties: {
        title: { type: 'string', default: '' },
        total: {
          type: 'number',
          default: 0,
          readOnly: true,
          'x-formula': { version: 1, expression: '1 + 2' },
        },
      },
      required: ['title', 'total'],
      additionalProperties: false,
    };
    const patches = [
      {
        op: 'move' as const,
        from: '/properties/title',
        path: '/properties/label',
      },
    ];
    const table = new SchemaTable(structuredClone(initial), pluginRefs);
    table.applyPatches(patches);
    const persistedTerminal = structuredClone(table.getSchema());
    const history: HistoryPatches[] = [
      {
        date: '2026-01-01T00:00:00.000Z',
        hash: objectHash(initial),
        patches: [{ op: 'add', path: '', value: initial }],
      },
      {
        date: '2026-01-02T00:00:00.000Z',
        hash: objectHash(persistedTerminal),
        patches,
      },
    ];

    expect(validateSchemaHistory(persistedTerminal, history, pluginRefs)).toBe(
      undefined,
    );
  });
});
