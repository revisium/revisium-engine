import { num, obj, str } from '@revisium/schema-toolkit/mocks';
import { ChangesScenario } from 'src/features/partial-changes-poc/__tests__/support/changes-scenario';
import {
  createPartialChangesTestKit,
  PartialChangesTestKit,
} from 'src/features/partial-changes-poc/__tests__/support/partial-changes-test-kit';
import {
  product,
  productSchema,
} from 'src/features/partial-changes-poc/__tests__/support/schemas';

const address = obj({ city: str() });
const addressWithZip = obj({ city: str(), zip: str() });
const money = obj({ amount: num(), currency: str() });

describe('shared schemas', () => {
  let kit: PartialChangesTestKit;

  beforeAll(async () => {
    kit = await createPartialChangesTestKit();
  });

  afterAll(async () => {
    await kit.close();
  });

  async function givenSharedSchemasEdited() {
    const scenario = await ChangesScenario.committed(
      kit,
      { products: { schema: productSchema, rows: { p1: product('one', 1) } } },
      (draft) => draft.putSharedSchema('address', address),
    );
    await scenario.putSharedSchema('address', addressWithZip);
    await scenario.putSharedSchema('money', money);
    await scenario.patchRow('products', 'p1', { price: 2 });
    return scenario;
  }

  it('commits one shared schema change alone', async () => {
    const scenario = await givenSharedSchemasEdited();

    const result = await scenario.commit({ sharedSchemas: ['address'] });

    expect(result.status).toBe('applied');
    expect(await scenario.sharedSchemas('head')).toEqual({
      address: addressWithZip,
    });
    expect(await scenario.sharedSchemas('draft')).toEqual({
      address: addressWithZip,
      money,
    });
    expect((await scenario.headRow('products', 'p1')).data.price).toBe(1);
  });

  it('reverts one shared schema change alone', async () => {
    const scenario = await givenSharedSchemasEdited();

    const result = await scenario.revert({ sharedSchemas: ['money'] });

    expect(result.status).toBe('applied');
    expect(await scenario.sharedSchemas('draft')).toEqual({
      address: addressWithZip,
    });
    expect((await scenario.draftRow('products', 'p1')).data.price).toBe(2);
  });
});
