import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { RowColumn } from 'src/features/partial-changes-poc/catalogue/row-columns';
import type { SchemaLeaf } from 'src/features/partial-changes-poc/catalogue/schema-leaves';
import type {
  PublicUnit,
  UnitKind,
} from 'src/features/partial-changes-poc/partial-changes.types';
import type {
  RowPair,
  RowVersion,
  TablePair,
} from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import type {
  LedgerAttribution,
  LedgerEntry,
} from 'src/features/partial-changes-poc/structure/ledger';
import type { TableViewsData } from 'src/features/views/types';

export interface CatalogueUnit {
  key: string;
  kind: UnitKind;
  tableCreatedId: string;
  tableId: string;
  previousTableId?: string;
  rowCreatedIds: string[];
  rowId?: string;
  previousRowId?: string;
  path?: string;
  columns?: RowColumn[];
}

export interface CatalogueRow {
  pair: RowPair;
  existenceUnit?: string;
  renameUnit?: string;
  columnsUnit?: string;
  fieldUnits: Map<string, string>;
  columnOwners: Map<RowColumn, string>;
}

export function catalogueRowOf(pair: RowPair): CatalogueRow {
  return { pair, fieldUnits: new Map(), columnOwners: new Map() };
}

export type CatalogueTableKind = 'data' | 'whole' | 'system' | 'unchanged';

export interface CatalogueTable {
  pair: TablePair;
  kind: CatalogueTableKind;
  tableId: string;
  leaves: SchemaLeaf[];
  changedPointers: string[];
  rows: Map<string, CatalogueRow>;
  unitKeys: string[];
  structureUnit?: string;
  viewsUnit?: string;
}

export interface ViewsPair {
  head?: RowVersion;
  draft?: RowVersion;
  migratedHead?: TableViewsData;
}

export interface CatalogueLedger {
  published: LedgerEntry[];
  pending: LedgerEntry[];
  attribution: LedgerAttribution;
  rewritten: string[];
}

export interface ChangeCatalogue {
  units: Map<string, CatalogueUnit>;
  tables: Map<string, CatalogueTable>;
  ledger: CatalogueLedger;
  schemaRows: Map<string, { head?: RowVersion; draft?: RowVersion }>;
  views: Map<string, ViewsPair>;
  sharedRows: Map<string, RowPair>;
  ownedRows: Map<string, RowVersion[]>;
  ownerUnits: Map<string, string>;
}

export type ViewsMigrator = (
  views: TableViewsData,
  pair: TablePair,
) => TableViewsData | undefined;

export function emptyCatalogue(): ChangeCatalogue {
  return {
    units: new Map(),
    tables: new Map(),
    ledger: {
      published: [],
      pending: [],
      attribution: { ownerOf: new Map(), transient: [], problems: [] },
      rewritten: [],
    },
    schemaRows: new Map(),
    views: new Map(),
    sharedRows: new Map(),
    ownedRows: new Map(),
    ownerUnits: new Map(),
  };
}

export function structureUnitOfOwner(
  catalogue: ChangeCatalogue,
  owner: string | undefined,
): string {
  const merged = owner ? catalogue.ownerUnits.get(owner) : undefined;
  if (merged) {
    return merged;
  }
  const table = owner ? catalogue.tables.get(owner) : undefined;
  return table?.structureUnit ?? `t:${owner ?? ''}/structure`;
}

export function schemaOfSide(
  pair: TablePair,
  side: 'head' | 'draft',
): JsonSchema | undefined {
  return side === 'head' ? pair.headSchema : pair.draftSchema;
}

export function toPublicUnit(unit: CatalogueUnit): PublicUnit {
  const result: PublicUnit = { kind: unit.kind, tableId: unit.tableId };

  if (unit.previousTableId !== undefined) {
    result.previousTableId = unit.previousTableId;
  }

  if (unit.rowId !== undefined) {
    result.rowId = unit.rowId;
  }

  if (unit.previousRowId !== undefined) {
    result.previousRowId = unit.previousRowId;
  }

  if (unit.path !== undefined) {
    result.path = unit.path;
  }

  if (unit.columns !== undefined) {
    result.columns = [...unit.columns];
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
