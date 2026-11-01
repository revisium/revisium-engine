import { Injectable } from '@nestjs/common';
import type { JsonValue } from '@revisium/schema-toolkit/types';
import {
  type AppliedUnits,
  OutcomeRules,
} from 'src/features/partial-changes/assembly/outcome-rules';
import type { AssembledTarget } from 'src/features/partial-changes/assembly/target-assembler';
import type { CatalogueRow } from 'src/features/partial-changes/catalogue/catalogue-unit';
import {
  blocking,
  type CheckSource,
  danglingInSource,
  type Finding,
  refusedBy,
  requiring,
  requiringOrDangling,
  type SideNames,
  sideNamesOf,
  type TargetCheck,
  type TargetChecking,
} from 'src/features/partial-changes/closure/findings';
import { LostIdReferrers } from 'src/features/partial-changes/closure/lost-id-referrers';
import {
  type ForeignKeyLeaf,
  TableSchemas,
} from 'src/features/partial-changes/closure/table-schemas';
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
import { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';
import { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';
import { getForeignKeyReferences } from 'src/features/share/foreign-key-references';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

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
  readonly leaf: ForeignKeyLeaf;
}

interface Covering {
  readonly unitKey: string;
  readonly leaf: JsonPointer;
}

interface OperationContext {
  readonly source: CheckSource;
  readonly lookup: CatalogueLookup;
  readonly snapshotReader: ChangesSnapshotReader;
  readonly schemas: TableSchemas;
  readonly referrers: LostIdReferrers;
}

@Injectable()
export class RowReferenceChecks implements TargetCheck {
  constructor(
    private readonly snapshotReader: ChangesSnapshotReader,
    private readonly schemaStore: JsonSchemaStoreService,
  ) {}

  public checkingOf(source: CheckSource): TargetChecking {
    return new RowReferenceChecking({
      source,
      lookup: new CatalogueLookup(source.catalogue),
      snapshotReader: this.snapshotReader,
      schemas: new TableSchemas(this.schemaStore),
      referrers: new LostIdReferrers(this.snapshotReader),
    });
  }
}

class RowReferenceChecking implements TargetChecking {
  constructor(private readonly context: OperationContext) {}

  public findingsOf(
    target: AssembledTarget,
    choice: AppliedUnits,
  ): Promise<Finding[]> {
    const rules = new OutcomeRules(choice);
    const tables = new TargetTables(
      this.context.source,
      target,
      rules,
      this.context.lookup,
    );

    return new TargetRowChecks(this.context, tables, rules).findings();
  }
}

class TargetRowChecks {
  private readonly names: SideNames;

  constructor(
    private readonly context: OperationContext,
    private readonly tables: TargetTables,
    private readonly rules: OutcomeRules,
  ) {
    this.names = sideNamesOf(rules.operation);
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
    return requiringOrDangling(idUnitOf(row), {
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

    const schema = this.context.schemas.storeOf(referrer.version);

    return referrer.heldRows.flatMap((held) =>
      getForeignKeyReferences(schema, held.data as JsonValue).flatMap(
        ({ tableId, rowId, legacyPath }) => {
          const referenced = this.tables.referencedBy(referrer, tableId);

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
      const ids = await this.context.snapshotReader.readExistingRowIds(
        table.version.versionId,
        [...rowIds],
      );

      existing.set(table, new Set(ids));
    }

    return existing;
  }

  private restoreReference(reference: Reference): Finding {
    const structure = this.unappliedStructureHolding(
      reference.referrer,
      reference.pointer,
    );
    const covering = coveringOf(reference.held.row, reference.pointer);
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

    if (covering && this.removesReference(covering, reference)) {
      return requiring(
        covering.unitKey,
        reasonOf(
          reference,
          'referrerStillReferences',
          `which the ${target} no longer contains`,
        ),
      );
    }

    return this.bringReferencedRow(reference, this.appliedUnitOf(covering));
  }

  private removesReference(
    { unitKey, leaf }: Covering,
    { referrer, held, referenced, rowId }: Reference,
  ): boolean {
    if (this.rules.isApplied(unitKey)) {
      return false;
    }

    const schema = this.context.schemas.storeOf(referrer.version);

    return referrer
      .versionsBroughtBy(unitKey, held.row)
      .every(
        ({ data }) =>
          !getForeignKeyReferences(schema, data as JsonValue).some(
            (brought) =>
              brought.tableId === referenced.tableId &&
              brought.rowId === rowId &&
              leaf.isAtOrAbove(JsonPointer.parse(brought.legacyPath)),
          ),
      );
  }

  private appliedUnitOf(covering: Covering | undefined): string | undefined {
    if (!covering || !this.rules.isApplied(covering.unitKey)) {
      return undefined;
    }

    return covering.unitKey;
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

    if (referenced.refusal) {
      return refusedBy(referenced.refusal);
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

  private unappliedStructureHolding(
    referrer: TargetTable,
    pointer: JsonPointer,
  ): string | undefined {
    const structure = this.context.lookup.tableUnitOf(
      'structure',
      referrer.pair,
    )?.key;

    if (
      structure === undefined ||
      this.rules.isApplied(structure) ||
      !referrer.isChangedField(pointer)
    ) {
      return undefined;
    }

    return structure;
  }

  private async unchangedReferrersOfLostIds(): Promise<Finding[]> {
    const findings: Finding[] = [];

    for (const scan of this.referrerScans()) {
      const referrers = await this.context.referrers.referrersOf(
        scan.referrer,
        scan.leaf.jsonPath,
        scan.losing,
      );

      for (const lostId of scan.lostIds) {
        const rowId = referrers.get(lostId);

        if (rowId !== undefined) {
          findings.push(this.restoreLostId(scan, lostId, rowId));
        }
      }
    }

    return findings;
  }

  private referrerScans(): ReferrerScan[] {
    const referrers = this.tables.all.filter(
      (table) => !table.isBroughtWholesale(),
    );

    return this.tables.all.flatMap((losing) => {
      const lostIds = losing.lostIds().sort(compareCodePoints);

      if (lostIds.length === 0) {
        return [];
      }

      return referrers
        .filter((referrer) => this.referencesLosing(referrer, losing))
        .flatMap((referrer) =>
          this.context.schemas
            .foreignKeyLeavesOf(referrer.version, losing.tableId)
            .map((leaf) => ({ losing, lostIds, referrer, leaf })),
        );
    });
  }

  private referencesLosing(
    referrer: TargetTable,
    losing: TargetTable,
  ): boolean {
    return this.tables.referencedBy(referrer, losing.tableId) === losing;
  }

  private restoreLostId(
    scan: ReferrerScan,
    referencedId: string,
    rowId: string,
  ): Finding {
    const { losing, referrer, leaf } = scan;
    const structure = this.unappliedStructureHolding(referrer, leaf.pointer);

    if (structure !== undefined) {
      return requiring(
        structure,
        this.structureBoundReasonOf(scan, referencedId, rowId),
      );
    }

    const reason: Reason = {
      code: 'referencedRowMissing',
      tableId: referrer.tableId,
      rowId,
      because: `${referrer.tableId}/${rowId} references ${losing.tableId}/${referencedId}, which the ${this.names.target} loses`,
    };

    return requiringOrDangling(
      losing.providerOf(referencedId),
      reason,
      losing.unitLosing(referencedId),
    );
  }

  private structureBoundReasonOf(
    { losing, referrer, leaf }: ReferrerScan,
    referencedId: string,
    rowId: string,
  ): Reason {
    const path = leaf.pointer.toString();

    return {
      code: 'structureBoundData',
      tableId: referrer.tableId,
      rowId,
      path,
      because: `${referrer.tableId}/${rowId}${path} references ${losing.tableId}/${referencedId}, which the ${this.names.target} loses; the value follows the structure of ${referrer.tableId}`,
    };
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

function coveringOf(
  { existence, leaves }: CatalogueRow,
  path: JsonPointer,
): Covering | undefined {
  if (existence !== undefined) {
    return { unitKey: existence, leaf: JsonPointer.root };
  }

  for (const [pointer, owner] of leaves) {
    const leaf = JsonPointer.parse(pointer);

    if (leaf.isAtOrAbove(path)) {
      return { unitKey: owner, leaf };
    }
  }

  return undefined;
}
