import {
  getNumberSchema,
  getObjectSchema,
} from '@revisium/schema-toolkit/mocks';
import { givenRowChanges } from './row-scenario';
import type { ChangesTestKit } from './test-kit';

export function givenFormulaChanges(
  kit: ChangesTestKit,
  expression = 'price * multiplier',
) {
  const headPrice = 2;
  const headMultiplier = 3;
  const draftPrice = 5;
  const draftMultiplier = 4;
  const storedTotal = 6;
  return givenRowChanges(kit, {
    schema: getObjectSchema({
      price: getNumberSchema(),
      multiplier: getNumberSchema(),
      total: {
        ...getNumberSchema(),
        readOnly: true,
        'x-formula': { version: 1, expression },
      },
    }),
    head: { price: headPrice, multiplier: headMultiplier, total: storedTotal },
    draft: {
      price: draftPrice,
      multiplier: draftMultiplier,
      total: storedTotal,
    },
  });
}
