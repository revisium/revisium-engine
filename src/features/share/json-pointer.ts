export function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function unescapePointer(value: string): string {
  return value.replace(/~1/g, '/').replace(/~0/g, '~');
}
