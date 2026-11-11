import type { CursorKind } from 'src/features/partial-changes/input/cursor-codec';

// A review's reproduction: about 27 KB of base64url around 10,000 nested arrays in the place of an id.
const NESTED_ARRAYS = 10_000;

export function deeplyNestedCursor(kind: CursorKind): string {
  const nested = `${'['.repeat(NESTED_ARRAYS)}0${']'.repeat(NESTED_ARRAYS)}`;
  const payload = `{"v":2,"kind":"${kind}","tableId":${nested}}`;

  return Buffer.from(payload).toString('base64url');
}
