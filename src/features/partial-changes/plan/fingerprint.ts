// The fingerprint of a plan in parts (SPEC §9.1), so that a stale result can say which of them changed (§9.2).
export interface Fingerprint {
  readonly operation: string;
  readonly headRevisionId: string;
  readonly draftRevisionId: string;
  // SHA-256 over the internal keys of the applied units, in unit order.
  readonly units: string;
  // SHA-256 over the content of the applied units, in unit order.
  readonly content: string;
}

// An expected fingerprint read by its prefix: one of these rules, or one of other rules (another engine version),
// whose payload is not decoded.
export type ExpectedFingerprint = Fingerprint | 'otherRules';

export const STALE_CHANGES = [
  'version',
  'operation',
  'revisions',
  'units',
  'content',
] as const;

export type StaleChange = (typeof STALE_CHANGES)[number];

const RULES = '2';

// [operation, headRevisionId, draftRevisionId, units, content]
const PAYLOAD_PARTS = 5;

const FINGERPRINT_FORMAT = /^pcf(\d+)\.([\w-]+)$/;

export function encodeFingerprint({
  operation,
  headRevisionId,
  draftRevisionId,
  units,
  content,
}: Fingerprint): string {
  const payload = [operation, headRevisionId, draftRevisionId, units, content];

  return `pcf${RULES}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
}

// Undefined when expected is malformed (SPEC §5.9).
export function readExpected(
  expected: string,
): ExpectedFingerprint | undefined {
  const [, rules, body] = FINGERPRINT_FORMAT.exec(expected) ?? [];

  if (body === undefined) {
    return undefined;
  }

  if (rules !== RULES) {
    return 'otherRules';
  }

  return fingerprintOf(body);
}

export function staleChangesOf(
  expected: ExpectedFingerprint,
  current: Fingerprint,
): StaleChange[] {
  if (expected === 'otherRules') {
    return ['version'];
  }

  const changed: StaleChange[] = [];

  if (expected.operation !== current.operation) {
    changed.push('operation');
  }

  if (
    expected.headRevisionId !== current.headRevisionId ||
    expected.draftRevisionId !== current.draftRevisionId
  ) {
    changed.push('revisions');
  }

  if (expected.units !== current.units) {
    changed.push('units');
  } else if (expected.content !== current.content) {
    changed.push('content');
  }

  return changed;
}

function fingerprintOf(body: string): Fingerprint | undefined {
  const bytes = Buffer.from(body, 'base64url');

  // Node skips a trailing character and stray bits; only the canonical form is base64url.
  if (bytes.toString('base64url') !== body) {
    return undefined;
  }

  const payload = parsedOf(bytes.toString());

  if (
    !Array.isArray(payload) ||
    payload.length !== PAYLOAD_PARTS ||
    !payload.every((part) => typeof part === 'string')
  ) {
    return undefined;
  }

  const [operation, headRevisionId, draftRevisionId, units, content] =
    payload as [string, string, string, string, string];

  return { operation, headRevisionId, draftRevisionId, units, content };
}

function parsedOf(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
