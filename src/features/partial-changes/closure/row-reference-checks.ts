import { Injectable } from '@nestjs/common';
import type { JsonSchemaStore } from '@revisium/schema-toolkit/model';
import type { JsonValue } from '@revisium/schema-toolkit/types';
import {
  type AppliedUnits,
  type ChangeOperation,
  OutcomeRules,
} from 'src/features/partial-changes/assembly/outcome-rules';
import type {
  AssembledTarget,
  AssemblySource,
} from 'src/features/partial-changes/assembly/target-assembler';
import type { CatalogueRow } from 'src/features/partial-changes/catalogue/catalogue-unit';
import {
  blocking,
  danglingInSource,
  type Finding,
  requiring,
  type TargetCheck,
} from 'src/features/partial-changes/closure/findings';
import {
  type HeldRow,
  idUnitOf,
  type TargetTable,
  TargetTables,
} from 'src/features/partial-changes/closure/target-tables';
import { CatalogueLookup } from 'src/features/partial-changes/selection/catalogue-lookup';
import type {
  Reason,
  RequiredReasonCode,
} from 'src/features/partial-changes/selection/selection-resolution';
import {
  ChangesSnapshotReader,
  type FirstReferrer,
} from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';
import { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';
import { getForeignKeyReferences } from 'src/features/share/foreign-key-references';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { getForeignKeyJsonPaths } from 'src/features/share/utils/get-foreign-key-json-paths';

interface SideNames {
  readonly target: string;
  readonly other: string;
}

interface Reference {
  readonly referrer: TargetTable;
  readonly held: HeldRow;
  readonly pointer: JsonPointer;
  readonly referenced: TargetTable;
  readonly rowId: string;
}

interface ReferrerScan {
  readonly losing: TargetTable;
  readonly lostIds: readonly string[];
  readonly referrer: TargetTable;
  readonly jsonPath: string;
}

const SIDE_NAMES: Readonly<Record<ChangeOperation, SideNames>> = {
  commit: { target: 'new Head', other: 'the Draft' },
  revert: { target: 'reverted Draft', other: 'Head' },
};

@Injectable()
export class RowReferenceChecks implements TargetCheck {
  constructor(
    private readonly snapshotReader: ChangesSnapshotReader,
    private readonly schemaStore: JsonSchemaStoreService,
  ) {}

  public findingsOf(
    source: AssemblySource,
    target: AssembledTarget,
    choice: AppliedUnits,
  ): Promise<Finding[]> {
    const rules = new OutcomeRules(choice);

    return new TargetRowChecks(
      source,
      new TargetTables(source, target, rules),
      rules,
      this.snapshotReader,
      this.schemaStore,
    ).findings();
  }
}

class TargetRowChecks {
  private readonly lookup: CatalogueLookup;
  private readonly names: SideNames;
  private readonly schemas = new Map<TargetTable, JsonSchemaStore>();

  constructor(
    private readonly source: AssemblySource,
    private readonly tables: TargetTables,
    private readonly rules: OutcomeRules,
    private readonly snapshotReader: ChangesSnapshotReader,
    private readonly schemaStore: JsonSchemaStoreService,
  ) {
    this.lookup = new CatalogueLookup(source.catalogue);
    this.names = SIDE_NAMES[rules.operation];
  }

  public async findings(): Promise<Finding[]> {
    return [
      ...this.idCollisions(),
      ...(await this.danglingReferences()),
      ...(await this.unchangedReferrersOfLostIds()),
    ];
  }

  private idCollisions(): Finding[] {
    return this.tables.all.flatMap((table) =>
      table
        .collisions()
        .flatMap(({ id, rows }) =>
          rows
            .filter(({ row }) => this.keepsBaseId(row, id))
            .map(({ row }) => this.moveFromOccupiedId(table, row, id)),
        ),
    );
  }

  private keepsBaseId(row: CatalogueRow, id: string): boolean {
    const unit = idUnitOf(row);

    return (
      row.pair[this.rules.baseSide]?.id === id &&
      (unit === undefined || !this.rules.isApplied(unit))
    );
  }

  private moveFromOccupiedId(
    { tableId }: TargetTable,
    row: CatalogueRow,
    rowId: string,
  ): Finding {
    return this.requiringOrDangling(idUnitOf(row), {
      code: 'idOccupied',
      tableId,
      rowId,
      because: `${tableId}/${rowId} would be held by two rows in the ${this.names.target}`,
    });
  }

  private async danglingReferences(): Promise<Finding[]> {
    const references = this.tables.all.flatMap((table) =>
      this.referencesFrom(table),
    );
    const missing = await this.missingAmong(references);

    return missing.map((reference) => this.restoreReference(reference));
  }

  private referencesFrom(referrer: TargetTable): Reference[] {
    if (referrer.heldRows.length === 0) {
      return [];
    }

    const schema = this.schemaOf(referrer);

    return referrer.heldRows.flatMap((held) =>
      getForeignKeyReferences(schema, held.data as JsonValue).flatMap(
        ({ tableId, rowId, legacyPath }) => {
          const referenced = this.tables.named(tableId);

          if (!referenced) {
            return [];
          }

          const pointer = JsonPointer.parse(legacyPath);

          return [{ referrer, held, pointer, referenced, rowId }];
        },
      ),
    );
  }

  private async missingAmong(
    references: readonly Reference[],
  ): Promise<Reference[]> {
    const unresolved = references.filter(
      ({ referenced, rowId }) => !referenced.holds(rowId),
    );
    const existing = await this.existingUntouchedIds(unresolved);

    return unresolved.filter(
      ({ referenced, rowId }) => !existing.get(referenced)?.has(rowId),
    );
  }

  private async existingUntouchedIds(
    references: readonly Reference[],
  ): Promise<Map<TargetTable, ReadonlySet<string>>> {
    const untouched = new Map<TargetTable, Set<string>>();
    const existing = new Map<TargetTable, ReadonlySet<string>>();

    for (const { referenced, rowId } of references) {
      if (!referenced.touches(rowId)) {
        untouched.set(
          referenced,
          (untouched.get(referenced) ?? new Set()).add(rowId),
        );
      }
    }

    for (const [table, rowIds] of untouched) {
      const ids = await this.snapshotReader.readExistingRowIds(
        table.version.versionId,
        [...rowIds],
      );

      existing.set(table, new Set(ids));
    }

    return existing;
  }

  private restoreReference(reference: Reference): Finding {
    const structure = this.unappliedStructureHolding(reference);
    const covering = coveringUnitOf(reference.held.row, reference.pointer);
    const { target } = this.names;

    if (structure !== undefined) {
      return requiring(
        structure,
        reasonOf(
          reference,
          'structureBoundData',
          `which the ${target} does not contain; the value follows the structure of ${reference.referrer.tableId}`,
        ),
      );
    }

    if (covering !== undefined && !this.rules.isApplied(covering)) {
      return requiring(
        covering,
        reasonOf(
          reference,
          'referrerStillReferences',
          `which the ${target} no longer contains`,
        ),
      );
    }

    return this.bringReferencedRow(reference, covering);
  }

  private bringReferencedRow(
    reference: Reference,
    covering: string | undefined,
  ): Finding {
    const { referenced, rowId } = reference;
    const provider = referenced.providerOf(rowId);

    if (provider !== undefined) {
      return requiring(
        provider,
        reasonOf(
          reference,
          'referencedRowMissing',
          `which exists only in ${this.names.other}`,
        ),
      );
    }

    const dangling = reasonOf(
      reference,
      'referencedRowMissing',
      `which the ${this.names.target} does not contain`,
    );

    return blocking(
      danglingInSource(
        dangling.because,
        dangling,
        covering ?? referenced.unitLosing(rowId),
      ),
    );
  }

  private unappliedStructureHolding({
    referrer,
    pointer,
  }: Reference): string | undefined {
    const structure = this.lookup.tableUnitOf('structure', referrer.pair)?.key;

    if (
      structure === undefined ||
      this.rules.isApplied(structure) ||
      !this.isChangedField(referrer, pointer)
    ) {
      return undefined;
    }

    return structure;
  }

  private isChangedField({ pair }: TargetTable, pointer: JsonPointer): boolean {
    const compared = this.source.tables.find(
      ({ identity }) => identity === pair.identity,
    );

    return (
      compared?.structure.changedPointers.some((changed) =>
        changed.isAtOrAbove(pointer),
      ) ?? false
    );
  }

  private async unchangedReferrersOfLostIds(): Promise<Finding[]> {
    const findings: Finding[] = [];

    for (const scan of this.referrerScans()) {
      const referrers = await this.snapshotReader.readFirstReferrers(
        scan.referrer.version.versionId,
        {
          jsonPath: scan.jsonPath,
          rowIds: scan.lostIds,
          exceptRows: scan.referrer.loadedIdentities,
        },
      );

      for (const found of referrers) {
        findings.push(this.restoreLostId(scan, found));
      }
    }

    return findings;
  }

  private referrerScans(): ReferrerScan[] {
    const referrers = this.tables.all.filter(
      (table) => !table.isBroughtWholesale(),
    );

    return this.tables.all.flatMap((losing) => {
      const lostIds = losing.lostIds();

      if (lostIds.length === 0) {
        return [];
      }

      return referrers.flatMap((referrer) =>
        getForeignKeyJsonPaths(this.schemaOf(referrer), losing.tableId).map(
          (jsonPath) => ({ losing, lostIds, referrer, jsonPath }),
        ),
      );
    });
  }

  private restoreLostId(
    { losing, referrer }: ReferrerScan,
    { referencedId, rowId }: FirstReferrer,
  ): Finding {
    const reason: Reason = {
      code: 'referencedRowMissing',
      tableId: referrer.tableId,
      rowId,
      because: `${referrer.tableId}/${rowId} references ${losing.tableId}/${referencedId}, which the ${this.names.target} loses`,
    };

    return this.requiringOrDangling(
      losing.providerOf(referencedId),
      reason,
      losing.unitLosing(referencedId),
    );
  }

  private schemaOf(table: TargetTable): JsonSchemaStore {
    const cached = this.schemas.get(table);

    if (cached) {
      return cached;
    }

    const schema = this.schemaStore.create(table.version.schema);
    this.schemas.set(table, schema);

    return schema;
  }

  private requiringOrDangling(
    unitKey: string | undefined,
    reason: Reason,
    culprit?: string,
  ): Finding {
    if (unitKey !== undefined) {
      return requiring(unitKey, reason);
    }

    return blocking(danglingInSource(reason.because, reason, culprit));
  }
}

function reasonOf(
  { referrer, held, pointer, referenced, rowId }: Reference,
  code: RequiredReasonCode,
  which: string,
): Reason {
  const path = pointer.toString();

  return {
    code,
    tableId: referrer.tableId,
    rowId: held.id,
    path,
    because: `${referrer.tableId}/${held.id}${path} references ${referenced.tableId}/${rowId}, ${which}`,
  };
}

function coveringUnitOf(
  { existence, leaves }: CatalogueRow,
  path: JsonPointer,
): string | undefined {
  if (existence !== undefined) {
    return existence;
  }

  for (const [pointer, owner] of leaves) {
    if (JsonPointer.parse(pointer).isAtOrAbove(path)) {
      return owner;
    }
  }

  return undefined;
}
