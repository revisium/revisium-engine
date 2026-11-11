import { obj } from '@revisium/schema-toolkit/mocks';
import type {
  TablePair,
  TableVersion,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import { tableIdentitiesOf } from 'src/features/partial-changes/snapshot/table-side';

describe('tableIdentitiesOf', () => {
  it('names the identity of every table id on the side that holds it', () => {
    const tables: TablePair[] = [
      { identity: 'renamed', head: table('products'), draft: table('goods') },
      { identity: 'removed', head: table('legacy') },
      { identity: 'created', draft: table('orders') },
    ];

    const { head, draft } = tableIdentitiesOf(tables);

    expect(Object.fromEntries(head)).toEqual({
      products: 'renamed',
      legacy: 'removed',
    });
    expect(Object.fromEntries(draft)).toEqual({
      goods: 'renamed',
      orders: 'created',
    });
  });
});

function table(id: string): TableVersion {
  return {
    versionId: `${id}-version`,
    createdId: `${id}-created`,
    id,
    readonly: false,
    schema: obj({}),
    history: [],
  };
}
