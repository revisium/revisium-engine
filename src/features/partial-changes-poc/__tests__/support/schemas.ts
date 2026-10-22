import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { num, numFormula, obj, ref, str } from '@revisium/schema-toolkit/mocks';

export const productSchema = obj({ title: str(), price: num(), qty: num() });

export const pricedProductSchema = obj({
  price: num(),
  qty: num(),
  total: numFormula('price * qty'),
});

export const orderSchema = obj({
  product: str({ foreignKey: 'products' }),
  note: str(),
});

export const documentSchema = obj({
  title: str(),
  photo: ref(SystemSchemaIds.File),
});

export const emptyFile = {
  status: '',
  fileId: '',
  url: '',
  fileName: '',
  hash: '',
  extension: '',
  mimeType: '',
  size: 0,
  width: 0,
  height: 0,
};

export function product(title: string, price: number, qty = 1) {
  return { title, price, qty };
}
