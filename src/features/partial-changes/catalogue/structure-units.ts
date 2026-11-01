import type { Row } from 'src/engine-prisma-types';
import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import {
  type CatalogueTables,
  distinctRows,
  previousTableIdOf,
  publicTableIdOf,
} from 'src/features/partial-changes/catalogue/catalogue-tables';
import type {
  LedgerAttribution,
  TableHistory,
} from 'src/features/partial-changes/catalogue/ledger-attribution';
import {
  groupPublicIdOf,
  groupRecreations,
  publicIdsOf,
} from 'src/features/partial-changes/catalogue/public-id-groups';
import type {
  HeadQualifier,
  Unit,
} from 'src/features/partial-changes/catalogue/unit';
import {
  structureUnitKey,
  transientStructureUnitKey,
} from 'src/features/partial-changes/catalogue/unit-key';
import { compareUnits } from 'src/features/partial-changes/catalogue/unit-order';
import type { TablePair } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { LedgerEntry } from 'src/features/share/ledger/migration-ledger';

interface StructureUnitParts {
  readonly key: string;
  readonly unit: Unit;
  readonly side?: HeadQualifier;
  readonly tables: readonly TablePair[];
  readonly transientEntries: LedgerEntry[];
}

const NO_PENDING_HISTORY: TableHistory = { tableIds: [], entries: [] };

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

    return groupRecreations(changed)
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
      const joined = tableUnits.find((unit) => this.sharesTableId(unit, group));

      if (joined) {
        joined.transientEntries.push(...group.entries);
      } else {
        transientUnits.push(transientStructureUnit(group));
      }
    }

    return transientUnits;
  }

  private sharesTableId(
    unit: StructureUnitParts,
    group: TableHistory,
  ): boolean {
    return this.tableIdsHeldBy(unit).some((tableId) =>
      group.tableIds.includes(tableId),
    );
  }

  private tableIdsHeldBy({ tables }: StructureUnitParts): string[] {
    return tables.flatMap((pair) => [
      ...publicIdsOf(pair),
      ...this.pendingHistoryOf(pair).tableIds,
    ]);
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
    const { entries } = this.pendingHistoryOf(pair);

    return [
      schema.head,
      schema.draft,
      views.head,
      views.draft,
      ...entries.map(({ row }) => row),
    ];
  }

  private pendingHistoryOf({ identity }: TablePair): TableHistory {
    return this.ledger.tables.get(identity) ?? NO_PENDING_HISTORY;
  }
}

function tableStructureUnit(
  tables: readonly TablePair[],
  takenOverTableIds: ReadonlySet<string>,
): StructureUnitParts {
  return {
    key: structureUnitKey(...tables.map(({ identity }) => identity)),
    unit: structureUnitAddressOf(tables),
    side: sideOfRemovedTable(tables, takenOverTableIds),
    tables,
    transientEntries: [],
  };
}

function transientStructureUnit(group: TableHistory): StructureUnitParts {
  const tableId = addressedTableIdOf(group);

  return {
    key: transientStructureUnitKey(tableId),
    unit: { kind: 'structure', tableId },
    tables: [],
    transientEntries: [...group.entries],
  };
}

function structureUnitAddressOf(tables: readonly TablePair[]): Unit {
  const tableId = groupPublicIdOf(tables);
  const previousTableId = tables
    .map(previousTableIdOf)
    .find((tableId) => tableId !== undefined);

  if (previousTableId !== undefined) {
    return { kind: 'structure', tableId, previousTableId };
  }

  return { kind: 'structure', tableId };
}

function sideOfRemovedTable(
  tables: readonly TablePair[],
  takenOverTableIds: ReadonlySet<string>,
): HeadQualifier | undefined {
  if (
    tables.every(isRemoved) &&
    takenOverTableIds.has(groupPublicIdOf(tables))
  ) {
    return 'head';
  }

  return undefined;
}

function addressedTableIdOf(group: TableHistory): string {
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

function isRemoved({ head, draft }: TablePair): boolean {
  return head !== undefined && draft === undefined;
}
