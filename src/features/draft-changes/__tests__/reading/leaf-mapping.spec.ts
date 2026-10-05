import type { DraftChangesCatalogueEntry } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';
import { mapCatalogueLeaves } from 'src/features/draft-changes/reading/leaf-mapping';

describe('draft changes leaf mapping', () => {
  it('preserves the empty root JSON Pointer in the public effect', () => {
    const entry: DraftChangesCatalogueEntry = {
      ref: { value: 'schema-root-ref' },
      kind: 'schemaField',
      target: {
        kind: 'schemaField',
        tableCreatedId: 'table-created-id',
        tableId: 'products',
        path: '',
      },
      classification: 'updated',
      path: '',
      before: { type: 'object' },
      after: { type: 'object', additionalProperties: false },
      beforeExists: true,
      afterExists: true,
      selectable: true,
    };

    const [leaf] = mapCatalogueLeaves([entry]);

    expect(leaf?.effect?.path).toBe('');
    expect(leaf?.ref).toEqual(entry.ref);
  });
});
