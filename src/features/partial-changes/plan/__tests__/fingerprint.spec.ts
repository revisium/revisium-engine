import {
  encodeFingerprint,
  type Fingerprint,
  readExpected,
  STALE_CHANGES,
  type StaleChange,
  staleChangesOf,
} from 'src/features/partial-changes/plan/fingerprint';

const UNITS = 'a'.repeat(64);
const CONTENT = 'b'.repeat(64);

const FINGERPRINT: Fingerprint = {
  operation: 'commit',
  headRevisionId: 'rev-h1',
  draftRevisionId: 'rev-d1',
  units: UNITS,
  content: CONTENT,
};

const BASE64URL =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const base64url = (text: string): string =>
  Buffer.from(text).toString('base64url');

// 27 bytes encode to whole base64url quantums; Node skips one more character.
const WHOLE_QUANTUMS = base64url('["commit","h","d","u","cc"]');
// 26 bytes leave two unused bits in the last character; Node ignores them.
const PARTIAL_QUANTUM = base64url('["commit","h","d","u","c"]');

describe('fingerprint (SPEC §9.1)', () => {
  it('encodes the parts as pcf2. and the base64url JSON array [operation, headRevisionId, draftRevisionId, units, content]', () => {
    const encoded = encodeFingerprint(FINGERPRINT);

    expect(encoded).toBe(
      `pcf2.${base64url(JSON.stringify(['commit', 'rev-h1', 'rev-d1', UNITS, CONTENT]))}`,
    );
    expect(encoded).toMatch(/^pcf2\.[\w-]+$/);
  });

  it('reads back the parts it encoded', () => {
    expect(readExpected(encodeFingerprint(FINGERPRINT))).toEqual(FINGERPRINT);
  });

  it('reads the parts of a pcf2 payload with any five strings', () => {
    const payload = ['publish', '', 'é', '1', '2'];

    expect(readExpected(`pcf2.${base64url(JSON.stringify(payload))}`)).toEqual({
      operation: 'publish',
      headRevisionId: '',
      draftRevisionId: 'é',
      units: '1',
      content: '2',
    });
  });

  it.each(['pcf3.AA', 'pcf3.not-decoded_at-all', 'pcf10.Zm9v', 'pcf02.AAAA'])(
    'reads %s as a fingerprint of other rules, without decoding it',
    (expected) => {
      expect(readExpected(expected)).toBe('otherRules');
    },
  );

  it.each([
    { malformed: 'a bare SHA-256 hex of engines before v2.0', expected: UNITS },
    { malformed: 'no version', expected: `pcf.${base64url('[]')}` },
    {
      malformed: 'an upper-case prefix',
      expected: `PCF2.${base64url('[]')}`,
    },
    { malformed: 'no body', expected: 'pcf2.' },
    { malformed: 'a body that is not base64url', expected: 'pcf3.a+b/c=' },
    { malformed: 'a padded body', expected: `pcf2.${base64url('[]')}=` },
    {
      malformed: 'a stray last character',
      expected: `pcf2.${WHOLE_QUANTUMS}A`,
    },
    {
      malformed: 'stray bits in the last character',
      expected: `pcf2.${withStrayBits(PARTIAL_QUANTUM)}`,
    },
    {
      malformed: 'a payload with JSON spacing',
      expected: `pcf2.${base64url('["commit", "h", "d", "u", "c"]')}`,
    },
    {
      malformed: 'a payload with a JSON escape',
      expected: `pcf2.${base64url('["\\u0063ommit","h","d","u","c"]')}`,
    },
    {
      malformed: 'a payload that is not UTF-8',
      expected: `pcf2.${Buffer.concat([
        Buffer.from('["commit","h","d","u","'),
        Buffer.from([0xff]),
        Buffer.from('"]'),
      ]).toString('base64url')}`,
    },
    {
      malformed: 'a payload that is not JSON',
      expected: `pcf2.${base64url('[')}`,
    },
    {
      malformed: 'a payload that is not an array',
      expected: `pcf2.${base64url('{"operation":"commit"}')}`,
    },
    {
      malformed: 'a four-element payload',
      expected: `pcf2.${base64url('["commit","h","d","u"]')}`,
    },
    {
      malformed: 'a six-element payload',
      expected: `pcf2.${base64url('["commit","h","d","u","c","x"]')}`,
    },
    {
      malformed: 'a payload with a number',
      expected: `pcf2.${base64url('["commit","h","d","u",1]')}`,
    },
    {
      malformed: 'a payload with null',
      expected: `pcf2.${base64url('["commit","h","d",null,"c"]')}`,
    },
  ])('reads nothing from $malformed', ({ expected }) => {
    expect(readExpected(expected)).toBeUndefined();
  });

  describe('staleChangesOf: the parts of expected that differ, in the order of SPEC §9.2', () => {
    const cases: {
      readonly when: string;
      readonly expected: Partial<Fingerprint> | 'otherRules';
      readonly changed: StaleChange[];
    }[] = [
      { when: 'every part is equal', expected: {}, changed: [] },
      {
        when: 'expected is of other rules, comparing nothing else',
        expected: 'otherRules',
        changed: ['version'],
      },
      {
        when: 'the operation differs',
        expected: { operation: 'revert' },
        changed: ['operation'],
      },
      {
        when: 'the Head revision differs',
        expected: { headRevisionId: 'rev-h0' },
        changed: ['revisions'],
      },
      {
        when: 'the Draft revision differs',
        expected: { draftRevisionId: 'rev-d0' },
        changed: ['revisions'],
      },
      {
        when: 'the units differ, not comparing the content',
        expected: { units: 'c'.repeat(64), content: 'd'.repeat(64) },
        changed: ['units'],
      },
      {
        when: 'only the content differs',
        expected: { content: 'd'.repeat(64) },
        changed: ['content'],
      },
      {
        when: 'every part differs',
        expected: {
          operation: 'revert',
          headRevisionId: 'rev-h0',
          draftRevisionId: 'rev-d0',
          units: 'c'.repeat(64),
          content: 'd'.repeat(64),
        },
        changed: ['operation', 'revisions', 'units'],
      },
      {
        when: 'the revisions and the content differ',
        expected: { draftRevisionId: 'rev-d0', content: 'd'.repeat(64) },
        changed: ['revisions', 'content'],
      },
    ];

    it.each(cases)('is $changed when $when', ({ expected, changed }) => {
      const read =
        expected === 'otherRules' ? expected : { ...FINGERPRINT, ...expected };

      expect(staleChangesOf(read, FINGERPRINT)).toEqual(changed);
    });

    it('covers every value of STALE_CHANGES, which lists them in the order of SPEC §9.2', () => {
      expect(new Set(cases.flatMap(({ changed }) => changed))).toEqual(
        new Set(STALE_CHANGES),
      );
      expect(STALE_CHANGES).toEqual([
        'version',
        'operation',
        'revisions',
        'units',
        'content',
      ]);
    });
  });
});

function withStrayBits(body: string): string {
  const last = BASE64URL.indexOf(body.slice(-1));

  return `${body.slice(0, -1)}${BASE64URL.charAt(last | 1)}`;
}
