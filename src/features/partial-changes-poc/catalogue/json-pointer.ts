export function toPointer(segments: readonly string[]): string {
  return segments
    .map((segment) => `/${segment.replace(/~/g, '~0').replace(/\//g, '~1')}`)
    .join('');
}

export function toSegments(pointer: string): string[] {
  if (pointer === '') {
    return [];
  }

  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function isSameOrInside(pointer: string, ancestor: string): boolean {
  return pointer === ancestor || pointer.startsWith(`${ancestor}/`);
}

export function readAt(value: unknown, segments: readonly string[]): unknown {
  let current = value;

  for (const segment of segments) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

export function writeAt(
  target: Record<string, unknown>,
  segments: readonly string[],
  value: unknown,
): void {
  const parentSegments = segments.slice(0, -1);
  const key = segments.at(-1);
  const parent = readAt(target, parentSegments);

  if (key === undefined || parent === null || typeof parent !== 'object') {
    throw new Error(`Cannot write at ${toPointer(segments)}`);
  }

  (parent as Record<string, unknown>)[key] = value;
}
