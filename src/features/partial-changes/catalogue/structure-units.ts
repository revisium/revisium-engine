import type { Row } from 'src/engine-prisma-types';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import {
  type CatalogueTables,
  distinctRows,
  previousTableIdOf,
  publicTableIdOf,
  tableIdsOf,
} from 'src/features/partial-changes/catalogue/catalogue-tables';
import type {
  LedgerAttribution,
  LedgerEntry,
  TransientGroup,
} from 'src/features/partial-changes/catalogue/ledger-attribution';
import type { Side, Unit } from 'src/features/partial-changes/catalogue/unit';
import {
  structureUnitKey,
  transientStructureUnitKey,
} from 'src/features/partial-changes/catalogue/unit-key';
import { compareUnits } from 'src/features/partial-changes/catalogue/unit-order';
import type { TablePair } from 'src/features/partial-changes/snapshot/changes-snapshot';

interface StructureTables {
  readonly table: TablePair;
  readonly recreated?: TablePair;
}

interface StructureUnitParts {
  readonly key: string;
  readonly unit: Unit;
  readonly side?: Side;
  readonly tables: readonly TablePair[];
  readonly transientEntries: LedgerEntry[];
}

export function buildStructureUnits(
  tables: CatalogueTables,
  ledger: LedgerAttribution,
): CatalogueUnit[] {
  return new StructureUnitsBuilder(tables, ledger).build();
}

class StructureUnitsBuilder {
  constructor(
    private readonly tables: CatalogueTables,
    private readonly ledger: LedgerAttribution,
  ) {}

  public build(): CatalogueUnit[] {
    const tableUnits = this.tableUnits();
    const transientUnits = this.joinTransientGroups(tableUnits);

    return [...tableUnits, ...transientUnits].map((parts) =>
      this.catalogueUnitOf(parts),
    );
  }

  private tableUnits(): StructureUnitParts[] {
    const changed = this.tables.pairs.filter((pair) =>
      this.hasStructureChange(pair),
    );
    const takenOverTableIds = takenOverTableIdsOf(changed);

    return structureTablesOf(changed)
      .map((tables) => tableStructureUnit(tables, takenOverTableIds))
      .sort(compareUnits);
  }

  private hasStructureChange(pair: TablePair): boolean {
    if (!pair.head || !pair.draft) {
      return true;
    }

    return this.tables.structureOf(pair).differs;
  }

  private joinTransientGroups(
    tableUnits: readonly StructureUnitParts[],
  ): StructureUnitParts[] {
    const transientUnits: StructureUnitParts[] = [];

    for (const group of this.ledger.transientGroups) {
      const joined = tableUnits.find((unit) => sharesTableId(unit, group));

      if (joined) {
        joined.transientEntries.push(...group.entries);
      } else {
        transientUnits.push(transientStructureUnit(group));
      }
    }

    return transientUnits;
  }

  private catalogueUnitOf(parts: StructureUnitParts): CatalogueUnit {
    const { key, unit, side, tables } = parts;

    return {
      key,
      tableIdentities: tables.map(({ identity }) => identity),
      rowIdentities: [],
      systemRows: this.ownedSystemRowsOf(parts),
      side,
      unit,
    };
  }

  private ownedSystemRowsOf({
    tables,
    transientEntries,
  }: StructureUnitParts): Row[] {
    return distinctRows([
      ...tables.flatMap((pair) => this.systemRowsOf(pair)),
      ...transientEntries.map(({ row }) => row),
    ]);
  }

  private systemRowsOf(pair: TablePair): (Row | undefined)[] {
    const schema = this.tables.schemaRowsOf(pair);
    const views = this.tables.viewsRowsOf(pair);
    const pending = this.ledger.tables.get(pair.identity) ?? [];

    return [
      schema.head,
      schema.draft,
      views.head,
      views.draft,
      ...pending.map(({ row }) => row),
    ];
  }
}

function structureTablesOf(pairs: readonly TablePair[]): StructureTables[] {
  const recreations = recreationsOf(pairs);
  const recreated = new Set(recreations.values());

  return pairs
    .filter((pair) => !recreated.has(pair))
    .map((table) => ({ table, recreated: recreations.get(table) }));
}

function recreationsOf(
  pairs: readonly TablePair[],
): ReadonlyMap<TablePair, TablePair> {
  const removedById = new Map(
    pairs.filter(isRemoved).map((pair) => [publicTableIdOf(pair), pair]),
  );
  const recreations = new Map<TablePair, TablePair>();

  for (const created of pairs.filter(isCreated)) {
    const removed = removedById.get(publicTableIdOf(created));

    if (removed) {
      recreations.set(removed, created);
    }
  }

  return recreations;
}

function tableStructureUnit(
  structureTables: StructureTables,
  takenOverTableIds: ReadonlySet<string>,
): StructureUnitParts {
  const tables = tablesOf(structureTables);

  return {
    key: structureUnitKey(...tables.map(({ identity }) => identity)),
    unit: structureUnitAddressOf(structureTables.table),
    side: sideOfRemovedTable(structureTables.table, takenOverTableIds),
    tables,
    transientEntries: [],
  };
}

function transientStructureUnit(group: TransientGroup): StructureUnitParts {
  const tableId = addressedTableIdOf(group);

  return {
    key: transientStructureUnitKey(tableId),
    unit: { kind: 'structure', tableId },
    tables: [],
    transientEntries: [...group.entries],
  };
}

function tablesOf({ table, recreated }: StructureTables): TablePair[] {
  if (recreated) {
    return [table, recreated];
  }

  return [table];
}

function structureUnitAddressOf(table: TablePair): Unit {
  const tableId = publicTableIdOf(table);
  const previousTableId = previousTableIdOf(table);

  if (previousTableId !== undefined) {
    return { kind: 'structure', tableId, previousTableId };
  }

  return { kind: 'structure', tableId };
}

function sideOfRemovedTable(
  table: TablePair,
  takenOverTableIds: ReadonlySet<string>,
): Side | undefined {
  if (isRemoved(table) && takenOverTableIds.has(publicTableIdOf(table))) {
    return 'head';
  }

  return undefined;
}

function addressedTableIdOf(group: TransientGroup): string {
  const [tableId] = group.tableIds;

  if (tableId === undefined) {
    throw new Error('A table created inside the Draft used no table id');
  }

  return tableId;
}

function takenOverTableIdsOf(pairs: readonly TablePair[]): Set<string> {
  return new Set(
    pairs
      .filter((pair) => previousTableIdOf(pair) !== undefined)
      .map(publicTableIdOf),
  );
}

function sharesTableId(
  unit: StructureUnitParts,
  group: TransientGroup,
): boolean {
  return unit.tables.some((pair) =>
    tableIdsOf(pair).some((tableId) => group.tableIds.includes(tableId)),
  );
}

function isRemoved({ head, draft }: TablePair): boolean {
  return head !== undefined && draft === undefined;
}

function isCreated({ head, draft }: TablePair): boolean {
  return head === undefined && draft !== undefined;
}
