import { pointerOfNativeFieldPath } from 'src/features/partial-changes/draft-reads/native-field-path';

describe('pointerOfNativeFieldPath', () => {
  it.each([
    ['', ''],
    ['title', '/title'],
    ['address.city', '/address/city'],
    ['tags.1', '/tags/1'],
    ['items.0.qty', '/items/0/qty'],
  ])(
    'reads the native field path %p as the JSON Pointer %p',
    (path, pointer) => {
      expect(pointerOfNativeFieldPath(path).toString()).toBe(pointer);
    },
  );
});
