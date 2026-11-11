export type Fields = Readonly<Record<string, unknown>>;

export function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasOnlyFields(
  value: Fields,
  fields: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((field) => fields.has(field));
}
