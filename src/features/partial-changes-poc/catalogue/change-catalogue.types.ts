import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { SchemaLeaf } from 'src/features/partial-changes-poc/catalogue/schema-leaves';
import type {
  PublicUnit,
  UnitKind,
} from 'src/features/partial-changes-poc/partial-changes.types';
import type {
  RowPair,
  TablePair,
} from 'src/features/partial-changes-poc/snapshot/snapshot.types';

export interface CatalogueUnit {
  key: string;
  kind: UnitKind;
  tableCreatedId: string;
  tableId: string;
  rowCreatedIds: string[];
  rowId?: string;
  previousRowId?: string;
  path?: string;
}

export interface CatalogueRow {
  pair: RowPair;
  existenceUnit?: string;
  renameUnit?: string;
  fieldUnits: Map<string, string>;
}

export type CatalogueTableKind = 'data' | 'structure' | 'system' | 'unchanged';

export interface CatalogueTable {
  pair: TablePair;
  kind: CatalogueTableKind;
  tableId: string;
  schema?: JsonSchema;
  leaves: SchemaLeaf[];
  rows: Map<string, CatalogueRow>;
  unitKeys: string[];
}

export interface ChangeCatalogue {
  units: Map<string, CatalogueUnit>;
  tables: Map<string, CatalogueTable>;
}

export function toPublicUnit(unit: CatalogueUnit): PublicUnit {
  const result: PublicUnit = { kind: unit.kind, tableId: unit.tableId };

  if (unit.rowId !== undefined) {
    result.rowId = unit.rowId;
  }

  if (unit.previousRowId !== undefined) {
    result.previousRowId = unit.previousRowId;
  }

  if (unit.path !== undefined) {
    result.path = unit.path;
  }

  return result;
}

export function compareUnits(a: CatalogueUnit, b: CatalogueUnit): number {
  return (
    a.tableId.localeCompare(b.tableId) ||
    (a.rowId ?? '').localeCompare(b.rowId ?? '') ||
    a.kind.localeCompare(b.kind) ||
    (a.path ?? '').localeCompare(b.path ?? '')
  );
}
