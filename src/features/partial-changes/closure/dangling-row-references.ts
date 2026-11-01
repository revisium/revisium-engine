import { Injectable } from '@nestjs/common';
import type { JsonValue } from '@revisium/schema-toolkit/types';
import type { CatalogueRow } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type {
  CheckContext,
  TargetCheck,
  TargetChecking,
} from 'src/features/partial-changes/closure/check-context';
import {
  type Finding,
  requiring,
} from 'src/features/partial-changes/closure/findings';
import {
  referencedRowFinding,
  referenceReason,
  type RowReference,
} from 'src/features/partial-changes/closure/row-reference';
import type {
  HeldRow,
  TargetTable,
} from 'src/features/partial-changes/closure/target-tables';
import { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';
import { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';
import { getForeignKeyReferences } from 'src/features/share/foreign-key-references';

interface Reference extends RowReference {
  readonly referrer: TargetTable;
  readonly held: HeldRow;
  readonly pointer: JsonPointer;
}

interface Covering {
  readonly unitKey: string;
  readonly leaf: JsonPointer;
}

@Injectable()
export class DanglingRowReferences implements TargetCheck, TargetChecking {
  constructor(private readonly snapshotReader: ChangesSnapshotReader) {}

  public checkingOf(): TargetChecking {
    return this;
  }

  public async findingsOf(context: CheckContext): Promise<Finding[]> {
    const references = context.tables.all.flatMap((table) =>
      this.referencesFrom(context, table),
    );
    const missing = await this.missingAmong(references);

    return missing.map((reference) =>
      this.restoreReference(context, reference),
    );
  }

  private referencesFrom(
    context: CheckContext,
    referrer: TargetTable,
  ): Reference[] {
    if (referrer.heldRows.length === 0) {
      return [];
    }

    const schema = context.schemas.storeOf(referrer.version);

    return referrer.heldRows.flatMap((held) =>
      getForeignKeyReferences(schema, held.data as JsonValue).flatMap(
        ({ tableId, rowId, legacyPath }) => {
          const referenced = context.tables.referencedBy(referrer, tableId);

          if (!referenced) {
            return [];
          }

          const pointer = JsonPointer.parse(legacyPath);
          const site = {
            tableId: referrer.tableId,
            rowId: held.id,
            path: pointer.toString(),
          };

          return [
            { referrer, held, pointer, site, referenced, referencedId: rowId },
          ];
        },
      ),
    );
  }

  private async missingAmong(
    references: readonly Reference[],
  ): Promise<Reference[]> {
    const unresolved = references.filter(
      ({ referenced, referencedId }) => !referenced.holds(referencedId),
    );
    const existing = await this.existingUntouchedIds(unresolved);

    return unresolved.filter(
      ({ referenced, referencedId }) =>
        !existing.get(referenced)?.has(referencedId),
    );
  }

  private async existingUntouchedIds(
    references: readonly Reference[],
  ): Promise<Map<TargetTable, ReadonlySet<string>>> {
    const untouched = new Map<TargetTable, Set<string>>();
    const existing = new Map<TargetTable, ReadonlySet<string>>();

    for (const { referenced, referencedId } of references) {
      if (!referenced.touches(referencedId)) {
        untouched.set(
          referenced,
          (untouched.get(referenced) ?? new Set()).add(referencedId),
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

  private restoreReference(
    context: CheckContext,
    reference: Reference,
  ): Finding {
    const structure = context.unappliedStructureHolding(
      reference.referrer,
      reference.pointer,
    );
    const covering = coveringOf(reference.held.row, reference.pointer);
    const { target } = context.names;

    if (structure !== undefined) {
      return requiring(
        structure,
        referenceReason(
          reference,
          'structureBoundData',
          `which the ${target} does not contain; the value follows the structure of ${reference.referrer.tableId}`,
        ),
      );
    }

    if (covering && this.removesReference(context, covering, reference)) {
      return requiring(
        covering.unitKey,
        referenceReason(
          reference,
          'referrerStillReferences',
          `which the ${target} no longer contains`,
        ),
      );
    }

    return referencedRowFinding(
      reference,
      context.names,
      this.appliedUnitOf(context, covering) ??
        reference.referenced.unitLosing(reference.referencedId),
    );
  }

  private removesReference(
    context: CheckContext,
    { unitKey, leaf }: Covering,
    { referrer, held, referenced, referencedId }: Reference,
  ): boolean {
    if (context.rules.isApplied(unitKey)) {
      return false;
    }

    const schema = context.schemas.storeOf(referrer.version);

    return referrer
      .versionsBroughtBy(unitKey, held.row)
      .every(
        ({ data }) =>
          !getForeignKeyReferences(schema, data as JsonValue).some(
            (brought) =>
              brought.tableId === referenced.tableId &&
              brought.rowId === referencedId &&
              leaf.isAtOrAbove(JsonPointer.parse(brought.legacyPath)),
          ),
      );
  }

  private appliedUnitOf(
    context: CheckContext,
    covering: Covering | undefined,
  ): string | undefined {
    if (!covering || !context.rules.isApplied(covering.unitKey)) {
      return undefined;
    }

    return covering.unitKey;
  }
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
