import { givenRowChanges } from './row-scenario';
import type { ChangesTestKit } from './test-kit';

export async function givenRenamedField(kit: ChangesTestKit) {
  const headPrice = 100;
  const draftPrice = 120;
  const f = await givenRowChanges(kit, {
    head: { price: headPrice, title: 'A' },
    draft: { price: draftPrice, title: 'B' },
  });
  await f.patchSchema([
    { op: 'move', from: '/properties/price', path: '/properties/cost' },
  ]);
  return f;
}

export async function givenRemovedEditedField(kit: ChangesTestKit) {
  const f = await givenRowChanges(kit, {
    head: { a: 1 },
    draft: { a: 1 },
  });
  await f.patchSchema([
    {
      op: 'add',
      path: '/properties/extra',
      value: { type: 'number', default: 0 },
    },
  ]);
  const independentValue = 7;
  await f.updateDraftRow({ a: 1, extra: independentValue });
  return f;
}

export async function givenSiblingSchemaChanges(kit: ChangesTestKit) {
  const f = await givenRowChanges(kit, { head: { a: 1 }, draft: { a: 1 } });
  await f.patchSchema([
    {
      op: 'add',
      path: '/properties/sku',
      value: { type: 'string', default: '' },
    },
    {
      op: 'add',
      path: '/properties/note',
      value: { type: 'string', default: '' },
    },
  ]);
  return f;
}
