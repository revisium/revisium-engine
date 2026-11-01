import type { UnitKind } from 'src/features/partial-changes/catalogue/unit';
import type { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';

export type RowUnitKind =
  | 'rowCreate'
  | 'rowDelete'
  | 'rowReplace'
  | 'rowRename'
  | 'rowColumns';

const NO_TABLE_IDENTITY = '';

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

export function structureUnitKey(...tableIdentities: string[]): string {
  return keyOf('structure', ...tableIdentities);
}

export function transientStructureUnitKey(tableId: string): string {
  return keyOf('structure', NO_TABLE_IDENTITY, tableId);
}

export function viewsUnitKey(tableIdentity: string): string {
  return keyOf('views', tableIdentity);
}

export function sharedSchemaUnitKey(...rowIdentities: string[]): string {
  return keyOf('sharedSchema', ...rowIdentities);
}

function keyOf(kind: UnitKind, ...identities: string[]): string {
  return JSON.stringify([kind, ...identities]);
}
