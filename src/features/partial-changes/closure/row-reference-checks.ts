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
  type TargetChecking,
} from 'src/features/partial-changes/closure/findings';
import { LostIdReferrers } from 'src/features/partial-changes/closure/lost-id-referrers';
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

interface Covering {
  readonly unitKey: string;
  readonly leaf: JsonPointer;
}

interface OperationContext {
  readonly source: AssemblySource;
  readonly snapshotReader: ChangesSnapshotReader;
  readonly schemaStore: JsonSchemaStoreService;
  readonly referrers: LostIdReferrers;
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

  public checkingOf(source: AssemblySource): TargetChecking {
    return new RowReferenceChecking({
      source,
      snapshotReader: this.snapshotReader,
      schemaStore: this.schemaStore,
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
    const tables = new TargetTables(this.context.source, target, rules);

    return new TargetRowChecks(this.context, tables, rules).findings();
  }
}

class TargetRowChecks {
  private readonly lookup: CatalogueLookup;
  private readonly names: SideNames;
  private readonly schemas = new Map<TargetTable, JsonSchemaStore>();

  constructor(
    private readonly context: OperationContext,
    private readonly tables: TargetTables,
    private readonly rules: OutcomeRules,
  ) {
    this.lookup = new CatalogueLookup(context.source.catalogue);
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
      const ids = await this.context.snapshotReader.readExistingRowIds(
        table.version.versionId,
        [...rowIds],
      );

      existing.set(table, new Set(ids));
    }

    return existing;
  }

  private restoreReference(reference: Reference): Finding {
    const structure = this.unappliedStructureHolding(reference);
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

    const schema = this.schemaOf(referrer);

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
    const compared = this.context.source.tables.find(
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
      const referrers = await this.context.referrers.referrersOf(
        scan.referrer,
        scan.jsonPath,
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

      return referrers.flatMap((referrer) =>
        getForeignKeyJsonPaths(this.schemaOf(referrer), losing.tableId).map(
          (jsonPath) => ({ losing, lostIds, referrer, jsonPath }),
        ),
      );
    });
  }

  private restoreLostId(
    { losing, referrer }: ReferrerScan,
    referencedId: string,
    rowId: string,
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

    const schema = this.context.schemaStore.create(table.version.schema);
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
