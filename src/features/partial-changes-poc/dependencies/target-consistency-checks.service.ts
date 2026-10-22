import { Injectable } from '@nestjs/common';
import type { JsonSchemaStore } from '@revisium/schema-toolkit/model';
import type { JsonSchema, JsonValue } from '@revisium/schema-toolkit/types';
import {
  outcomeData,
  RowOutcome,
  TargetRow,
  TargetState,
} from 'src/features/partial-changes-poc/assembly/target.types';
import { CatalogueRow } from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import { isSameOrInside } from 'src/features/partial-changes-poc/catalogue/json-pointer';
import { RowLookup } from 'src/features/partial-changes-poc/dependencies/row-lookup.service';
import {
  IndexedTable,
  TargetIndex,
} from 'src/features/partial-changes-poc/dependencies/target-index';
import {
  Blocker,
  RequiredReason,
} from 'src/features/partial-changes-poc/partial-changes.types';
import { sideOf } from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import { getForeignKeyReferences } from 'src/features/share/foreign-key-references';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { getForeignKeyJsonPaths } from 'src/features/share/utils/get-foreign-key-json-paths';

export type Finding =
  | { type: 'require'; unit: string; reason: RequiredReason }
  | { type: 'blocker'; blocker: Blocker };

interface Reference {
  source: IndexedTable;
  row: TargetRow;
  path: string;
  tableId: string;
  rowId: string;
}

@Injectable()
export class TargetConsistencyChecks {
  private readonly schemaStores = new WeakMap<object, JsonSchemaStore>();

  constructor(
    private readonly rowLookup: RowLookup,
    private readonly jsonSchemaStore: JsonSchemaStoreService,
  ) {}

  async find(
    state: TargetState,
    applied: ReadonlySet<string>,
  ): Promise<Finding[]> {
    const index = new TargetIndex(state);
    const sideNames = sideNamesOf(state);

    return [
      ...this.idCollisions(index),
      ...(await this.danglingReferences(index, applied, sideNames)),
      ...(await this.referencesToRemovedRows(index, sideNames)),
    ];
  }

  private idCollisions(index: TargetIndex): Finding[] {
    return index.tables.flatMap((table) =>
      [...table.resultIds]
        .filter(([, rows]) => rows.length > 1)
        .flatMap(([id, rows]) =>
          rows
            .filter(({ outcome }) => keepsBaseId(outcome))
            .map(({ row }) => this.moveAwayFromId(index, table, row, id)),
        ),
    );
  }

  private moveAwayFromId(
    index: TargetIndex,
    table: IndexedTable,
    row: CatalogueRow,
    id: string,
  ): Finding {
    const other = sideOf(row.pair, index.state.direction.other);
    return unitOrBlocker(other ? row.renameUnit : row.existenceUnit, {
      code: 'idOccupied',
      tableId: table.publicId,
      rowId: id,
      because: `${table.publicId}/${id} would be held by two rows; the row that still keeps the id has to move as well`,
    });
  }

  private async danglingReferences(
    index: TargetIndex,
    applied: ReadonlySet<string>,
    sideNames: SideNames,
  ): Promise<Finding[]> {
    const references = index.tables.flatMap((table) =>
      table.target.rows.flatMap((row) => this.referencesOf(table, row)),
    );
    const missing = await this.missingReferences(index, references);

    return missing.map((reference) =>
      this.fixDanglingReference(index, reference, applied, sideNames),
    );
  }

  private referencesOf(table: IndexedTable, row: TargetRow): Reference[] {
    const data = outcomeData(row.outcome);
    if (data === undefined || !table.schema) {
      return [];
    }

    return getForeignKeyReferences(
      this.schemaStore(table.schema),
      data as JsonValue,
    ).map((reference) => ({
      source: table,
      row,
      path: reference.legacyPath,
      tableId: reference.tableId,
      rowId: reference.rowId,
    }));
  }

  private async missingReferences(
    index: TargetIndex,
    references: Reference[],
  ): Promise<Reference[]> {
    const missing: Reference[] = [];
    const pending = new Map<IndexedTable, Reference[]>();

    for (const reference of references) {
      const target = index.table(reference.tableId);
      if (!target || target.touchedIds.has(reference.rowId)) {
        if (!target?.resultIds.has(reference.rowId)) {
          missing.push(reference);
        }
        continue;
      }
      if (!target.resultIds.has(reference.rowId)) {
        const waiting = pending.get(target) ?? [];
        waiting.push(reference);
        pending.set(target, waiting);
      }
    }

    for (const [target, waiting] of pending) {
      const existing = await this.rowLookup.findExistingIds(
        target.version.versionId,
        [...new Set(waiting.map((reference) => reference.rowId))],
      );
      missing.push(
        ...waiting.filter((reference) => !existing.has(reference.rowId)),
      );
    }

    return missing;
  }

  private fixDanglingReference(
    index: TargetIndex,
    reference: Reference,
    applied: ReadonlySet<string>,
    sideNames: SideNames,
  ): Finding {
    const { source, row } = reference;
    const sourceRowId = rowIdOf(row);
    const covering = coveringUnit(row.row, reference.path);

    if (covering && !applied.has(covering)) {
      return {
        type: 'require',
        unit: covering,
        reason: {
          code: 'referrerStillReferences',
          tableId: source.publicId,
          rowId: sourceRowId,
          path: reference.path,
          because: `${source.publicId}/${sourceRowId}${reference.path} would still reference ${reference.tableId}/${reference.rowId}, which the ${sideNames.target} does not contain; its ${sideNames.other} value has to be taken as well`,
        },
      };
    }

    return unitOrBlocker(
      this.providerUnit(index, reference.tableId, reference.rowId),
      {
        code: 'referencedRowMissing',
        tableId: reference.tableId,
        rowId: reference.rowId,
        because: `${source.publicId}/${sourceRowId}${reference.path} references ${reference.tableId}/${reference.rowId}, which exists only in the ${sideNames.other}`,
      },
    );
  }

  private async referencesToRemovedRows(
    index: TargetIndex,
    sideNames: SideNames,
  ): Promise<Finding[]> {
    const findings: Finding[] = [];

    for (const removedFrom of index.tables) {
      if (removedFrom.removedIds.length === 0) {
        continue;
      }
      for (const referrer of index.tables) {
        findings.push(
          ...(await this.unchangedReferrers(
            index,
            removedFrom,
            referrer,
            sideNames,
          )),
        );
      }
    }

    return findings;
  }

  private async unchangedReferrers(
    index: TargetIndex,
    removedFrom: IndexedTable,
    referrer: IndexedTable,
    sideNames: SideNames,
  ): Promise<Finding[]> {
    const findings: Finding[] = [];

    for (const jsonPath of this.foreignKeyPaths(
      referrer.schema,
      removedFrom.publicId,
    )) {
      const rows = await this.rowLookup.findReferrers(
        referrer.version.versionId,
        jsonPath,
        removedFrom.removedIds,
      );
      for (const row of rows.filter(
        (found) => !referrer.target.table.rows.has(found.createdId),
      )) {
        findings.push(
          this.fixUnchangedReferrer(
            index,
            removedFrom,
            referrer,
            row,
            sideNames,
          ),
        );
      }
    }

    return findings;
  }

  private fixUnchangedReferrer(
    index: TargetIndex,
    removedFrom: IndexedTable,
    referrer: IndexedTable,
    row: { id: string; value: string },
    sideNames: SideNames,
  ): Finding {
    const reason: RequiredReason = {
      code: 'referrerStillReferences',
      tableId: referrer.publicId,
      rowId: row.id,
      because: `${referrer.publicId}/${row.id} references ${removedFrom.publicId}/${row.value}, which the selection removes from the ${sideNames.target}`,
    };

    if (
      referrer.target.table.kind === 'structure' &&
      referrer.target.outcome === 'base'
    ) {
      return unitOrBlocker(referrer.target.table.unitKeys[0], reason);
    }

    return unitOrBlocker(
      this.providerUnit(index, removedFrom.publicId, row.value),
      { ...reason, code: 'referencedRowMissing' },
    );
  }

  private providerUnit(
    index: TargetIndex,
    tableId: string,
    rowId: string,
  ): string | undefined {
    const table = index.table(tableId);
    if (!table) {
      return undefined;
    }

    if (table.target.table.kind === 'structure') {
      return table.target.table.unitKeys[0];
    }

    const row = table.otherIds.get(rowId);
    if (!row) {
      return undefined;
    }

    const base = sideOf(row.pair, index.state.direction.base);
    if (!base) {
      return row.existenceUnit;
    }

    return base.id === rowId
      ? undefined
      : (row.renameUnit ?? row.existenceUnit);
  }

  private foreignKeyPaths(
    schema: JsonSchema | undefined,
    tableId: string,
  ): string[] {
    if (!schema) {
      return [];
    }
    return getForeignKeyJsonPaths(this.schemaStore(schema), tableId);
  }

  private schemaStore(schema: JsonSchema): JsonSchemaStore {
    const cached = this.schemaStores.get(schema);
    if (cached) {
      return cached;
    }
    const store = this.jsonSchemaStore.create(schema);
    this.schemaStores.set(schema, store);
    return store;
  }
}

interface SideNames {
  target: string;
  other: string;
}

function sideNamesOf(state: TargetState): SideNames {
  return state.direction.other === 'draft'
    ? { target: 'new Head', other: 'Draft' }
    : { target: 'reverted Draft', other: 'Head' };
}

function rowIdOf(row: TargetRow): string {
  const { outcome } = row;
  if (outcome.kind === 'merged') {
    return outcome.id;
  }
  if (outcome.kind === 'absent') {
    return (row.row.pair.draft ?? row.row.pair.head)?.id ?? '';
  }
  return outcome.version.id;
}

function keepsBaseId(outcome: RowOutcome): boolean {
  return (
    outcome.kind === 'base' ||
    (outcome.kind === 'merged' && !outcome.idFromOther)
  );
}

function coveringUnit(row: CatalogueRow, path: string): string | undefined {
  if (row.existenceUnit) {
    return row.existenceUnit;
  }

  for (const [unitPath, key] of row.fieldUnits) {
    if (isSameOrInside(path, unitPath)) {
      return key;
    }
  }

  return undefined;
}

function unitOrBlocker(
  unit: string | undefined,
  reason: RequiredReason,
): Finding {
  if (unit) {
    return { type: 'require', unit, reason };
  }

  return {
    type: 'blocker',
    blocker: {
      code: 'danglingInSource',
      tableId: reason.tableId,
      rowId: reason.rowId,
      path: reason.path,
      message: `No change can restore consistency: ${reason.because}`,
    },
  };
}
