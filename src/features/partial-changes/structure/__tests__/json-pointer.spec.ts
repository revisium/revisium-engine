import { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';

describe('JsonPointer', () => {
  it.each([
    { text: '', segments: [] },
    { text: '/price', segments: ['price'] },
    { text: '/address/city', segments: ['address', 'city'] },
    { text: '/', segments: [''] },
    { text: '/a~1b', segments: ['a/b'] },
    { text: '/m~0n', segments: ['m~n'] },
    { text: '/~01', segments: ['~1'] },
    { text: '/~10', segments: ['/0'] },
  ])('parses "$text" into its unescaped segments', ({ text, segments }) => {
    expect(JsonPointer.parse(text).segments).toEqual(segments);
  });

  it.each([
    { segments: ['price'], text: '/price' },
    { segments: ['a/b'], text: '/a~1b' },
    { segments: ['m~n'], text: '/m~0n' },
    { segments: ['~1'], text: '/~01' },
  ])('builds "$text" from its segments', ({ segments, text }) => {
    expect(pointerOf(segments).toString()).toBe(text);
  });

  it.each(['price', '/price~', '/price~2'])(
    'refuses "%s", which is not a JSON Pointer',
    (text) => {
      expect(() => JsonPointer.parse(text)).toThrow(
        `Invalid JSON Pointer "${text}"`,
      );
    },
  );

  it.each([
    { ancestor: '/address', pointer: '/address', expected: true },
    { ancestor: '/address', pointer: '/address/city', expected: true },
    { ancestor: '', pointer: '/address/city', expected: true },
    { ancestor: '/address/city', pointer: '/address', expected: false },
    { ancestor: '/address', pointer: '/addressLine', expected: false },
    { ancestor: '/a~1b', pointer: '/a/b', expected: false },
  ])(
    'tells whether "$ancestor" is at or above "$pointer" ($expected)',
    ({ ancestor, pointer, expected }) => {
      expect(
        JsonPointer.parse(ancestor).isAtOrAbove(JsonPointer.parse(pointer)),
      ).toBe(expected);
    },
  );
});

function pointerOf(segments: readonly string[]): JsonPointer {
  return segments.reduce(
    (pointer, segment) => pointer.child(segment),
    JsonPointer.root,
  );
}
