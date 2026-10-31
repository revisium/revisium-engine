import type { UnitKind } from 'src/features/partial-changes/catalogue/unit';
import type { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';

export type RowUnitKind =
  | 'rowCreate'
  | 'rowDelete'
  | 'rowReplace'
  | 'rowRename'
  | 'rowColumns';

export function rowUnitKey(
  kind: RowUnitKind,
  tableIdentity: string,
  rowIdentities: readonly string[],
): string {
  return keyOf(kind, tableIdentity, ...rowIdentities);
}

export function fieldUnitKey(
  tableIdentity: string,
  rowIdentity: string,
  pointer: JsonPointer,
): string {
  return keyOf('field', tableIdentity, rowIdentity, pointer.toString());
}

export function structureUnitKey(tableIdentity: string): string {
  return keyOf('structure', tableIdentity);
}

function keyOf(kind: UnitKind, ...identities: string[]): string {
  return JSON.stringify([kind, ...identities]);
}
