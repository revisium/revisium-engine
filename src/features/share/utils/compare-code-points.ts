const LAST_SINGLE_UNIT_CODE_POINT = 0xffff;
const SURROGATE_PAIR_LENGTH = 2;

export function compareCodePoints(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  let index = 0;

  while (index < length) {
    const leftCodePoint = left.codePointAt(index) ?? 0;
    const rightCodePoint = right.codePointAt(index) ?? 0;

    if (leftCodePoint !== rightCodePoint) {
      return leftCodePoint - rightCodePoint;
    }

    index += lengthOf(leftCodePoint);
  }

  return left.length - right.length;
}

function lengthOf(codePoint: number): number {
  if (codePoint > LAST_SINGLE_UNIT_CODE_POINT) {
    return SURROGATE_PAIR_LENGTH;
  }

  return 1;
}
