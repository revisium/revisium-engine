import {
  cutValueOf,
  jsonBytesOf,
  type LimitedValue,
  measuredValueOf,
  textSliceOf,
} from 'src/features/partial-changes/draft-reads/json-values';

const EMOJI = '\u{1F600}';

describe('JSON values of the Draft reads', () => {
  describe('size', () => {
    it.each<[string, unknown]>([
      ['an empty string', ''],
      ['an ASCII string', 'abc'],
      ['a string of two-, three- and four-byte characters', `é€${EMOJI}`],
      ['a string of escaped characters', '"\\\n\t\u0001\u001f'],
      ['an object', { a: [1, 'x', null], b: { c: true } }],
      ['null', null],
      ['a number', 1.5],
    ])(
      'counts the UTF-8 bytes of the compact JSON text of %s',
      (_case, value) => {
        expect(jsonBytesOf(value)).toBe(
          Buffer.byteLength(JSON.stringify(value)),
        );
      },
    );
  });

  describe('cut', () => {
    it('returns a value within the limit whole, with its size', () => {
      expect(cutOf('abc', 5)).toEqual({ value: 'abc', bytes: 5 });
      expect(cutOf({ a: 1 }, 7)).toEqual({ value: { a: 1 }, bytes: 7 });
    });

    it('cuts a longer string to its longest prefix whose JSON text fits the limit', () => {
      expect(cutOf('abcdef', 5)).toEqual({
        value: 'abc',
        bytes: 8,
        cut: 'prefix',
      });
    });

    it('never splits a multi-byte character', () => {
      expect(cutOf('aé€', 6)).toEqual({
        value: 'aé',
        bytes: 8,
        cut: 'prefix',
      });
      expect(cutOf('aé€', 5)).toEqual({
        value: 'aé',
        bytes: 8,
        cut: 'prefix',
      });
      expect(cutOf('aé€', 4)).toEqual({
        value: 'a',
        bytes: 8,
        cut: 'prefix',
      });
    });

    it('never splits the surrogate pair of an emoji at the boundary', () => {
      expect(cutOf(`a${EMOJI}b`, 6)).toEqual({
        value: 'a',
        bytes: 8,
        cut: 'prefix',
      });
      expect(cutOf(`a${EMOJI}b`, 7)).toEqual({
        value: `a${EMOJI}`,
        bytes: 8,
        cut: 'prefix',
      });
    });

    it('counts an escaped character by its escape', () => {
      expect(cutOf('a"b', 4)).toEqual({
        value: 'a',
        bytes: 6,
        cut: 'prefix',
      });
      expect(cutOf('a\u0001b', 8)).toEqual({
        value: 'a',
        bytes: 10,
        cut: 'prefix',
      });
      expect(cutOf('a\u0001b', 9)).toEqual({
        value: 'a\u0001',
        bytes: 10,
        cut: 'prefix',
      });
    });

    it('cuts a string to the empty string at the smallest limit', () => {
      expect(cutOf('a', 2)).toEqual({
        value: '',
        bytes: 3,
        cut: 'prefix',
      });
    });

    it.each<[string, unknown]>([
      ['an object', { title: 'a long title' }],
      ['an array', ['a', 'b', 'c']],
      ['a number', 1234567],
      ['a boolean', false],
    ])('omits %s over the limit, with its size', (_case, value) => {
      expect(cutOf(value, 4)).toEqual({
        value: null,
        bytes: Buffer.byteLength(JSON.stringify(value)),
        cut: 'omitted',
      });
    });
  });

  describe('token', () => {
    it('gives equal values one token and different values different tokens, whatever the cut', () => {
      const long = 'x'.repeat(100);

      expect(cutValueOf(long, 10).token).toBe(measuredValueOf(long).token);
      expect(measuredValueOf({ a: [1] }).token).toBe(
        measuredValueOf({ a: [1] }).token,
      );
      expect(measuredValueOf('abcdef').token).not.toBe(
        measuredValueOf('abcXYZ').token,
      );
      expect(measuredValueOf('1').token).not.toBe(measuredValueOf(1).token);
    });
  });

  describe('text slice', () => {
    const text = `a${EMOJI}b`;

    it('returns the code units from the offset up to the limit', () => {
      expect(textSliceOf('abcdef', 2, 3)).toEqual({ offset: 2, text: 'cde' });
      expect(textSliceOf('abcdef', 4, undefined)).toEqual({
        offset: 4,
        text: 'ef',
      });
    });

    it('ends before a surrogate pair the limit would split', () => {
      expect(textSliceOf(text, 0, 2)).toEqual({ offset: 0, text: 'a' });
    });

    it('takes a whole surrogate pair when the limit holds only its first half', () => {
      expect(textSliceOf(text, 1, 1)).toEqual({ offset: 1, text: EMOJI });
    });

    it('starts at a surrogate pair when the offset falls between its halves', () => {
      expect(textSliceOf(text, 2, 3)).toEqual({ offset: 1, text: `${EMOJI}b` });
    });

    it('returns the empty text at the end for an offset past it', () => {
      expect(textSliceOf(text, 10, 5)).toEqual({ offset: 4, text: '' });
    });
  });
});

function cutOf(value: unknown, maxBytes: number): Omit<LimitedValue, 'token'> {
  const { token: _token, ...cut } = cutValueOf(value, maxBytes);

  return cut;
}
