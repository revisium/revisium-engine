import objectHash from 'object-hash';

export function sameJson(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return objectHash(canonical(a)) === objectHash(canonical(b));
}

function canonical(value: unknown): object {
  return { value: JSON.parse(JSON.stringify(value)) as unknown };
}
