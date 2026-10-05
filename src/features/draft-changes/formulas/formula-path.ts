import { escapePointer } from 'src/features/draft-changes/schema/json-value-path';
import { convertJsonPathToSchemaPath } from '@revisium/schema-toolkit/lib';

export function formulaPathToPointer(path: string): string {
  const normalized = path.replace(/\[(\d+)\]/g, '.$1');
  const segments = normalized.split('.').filter(Boolean);
  return segments.length === 0
    ? ''
    : `/${segments.map(escapePointer).join('/')}`;
}

export function formulaPathToSchemaPointer(path: string): string {
  return convertJsonPathToSchemaPath(path.replace(/\[\]/g, '[0]'));
}

export function readFormulaPath(
  value: unknown,
  path: string,
): { exists: boolean; value?: unknown } {
  let current = value;
  for (const segment of formulaPathSegments(path)) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { exists: false };
      }
      current = current[index];
      continue;
    }
    if (
      current === null ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return { exists: false };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current === undefined
    ? { exists: false }
    : { exists: true, value: current };
}

function formulaPathSegments(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
}
