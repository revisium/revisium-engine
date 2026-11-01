import type { CatalogueUnit } from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { CatalogueLookup } from 'src/features/partial-changes/selection/catalogue-lookup';
import type { FieldRef } from 'src/features/partial-changes/selection/selection';
import type {
  PlanBlocker,
  Reason,
  RequiredReasonCode,
} from 'src/features/partial-changes/selection/selection-resolution';
import {
  blocking,
  combined,
  NO_MATCH,
  requiring,
  type SelectorMatch,
  selecting,
} from 'src/features/partial-changes/selection/selector-match';
import type { TablePair } from 'src/features/partial-changes/snapshot/changes-snapshot';
import { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';
import type { SchemaLeaf } from 'src/features/partial-changes/structure/schema-leaves';
import type { TableStructure } from 'src/features/partial-changes/structure/table-structure';

export class FieldNormalisation {
  private readonly path: JsonPointer;
  private readonly structure: TableStructure;
  private readonly address: string;

  constructor(
    private readonly lookup: CatalogueLookup,
    private readonly table: TablePair,
    private readonly selector: FieldRef,
  ) {
    this.path = JsonPointer.parse(selector.path);
    this.structure = lookup.structureOf(table);
    this.address = `${selector.tableId}/${selector.rowId}`;
  }

  public match(): SelectorMatch {
    const leaf = this.unchangedLeafAtOrAbovePath();

    if (leaf?.kind === 'computed') {
      return blocking([this.notSelectable()]);
    }

    return combined(
      this.matchUnitsOfRow(leaf),
      this.requireStructureOfChangedFields(),
    );
  }

  private unchangedLeafAtOrAbovePath(): SchemaLeaf | undefined {
    return this.structure.unchangedLeaves.find(({ pointer }) =>
      pointer.isAtOrAbove(this.path),
    );
  }

  private matchUnitsOfRow(leaf: SchemaLeaf | undefined): SelectorMatch {
    const row = this.lookup.rowNamed(this.table, this.selector.rowId);

    if (!row) {
      return NO_MATCH;
    }

    if (row.existence !== undefined) {
      return this.requireExistence(row.existence);
    }

    const fields = this.lookup
      .unitsOfRow(row)
      .filter(({ unit }) => unit.kind === 'field');

    if (leaf && this.pointsInside(leaf)) {
      return this.requireAtomicValue(leaf, fields);
    }

    return selecting(
      fields.filter((field) => this.path.isAtOrAbove(pointerOf(field))),
    );
  }

  private pointsInside(leaf: SchemaLeaf): boolean {
    return !this.path.isAtOrAbove(leaf.pointer);
  }

  private requireExistence(existenceKey: string): SelectorMatch {
    return requiring(
      this.lookup.unit(existenceKey),
      this.reason(
        'wholeRowUnit',
        `${this.address} is created, deleted or replaced as a whole row`,
      ),
    );
  }

  private requireAtomicValue(
    leaf: SchemaLeaf,
    fields: readonly CatalogueUnit[],
  ): SelectorMatch {
    if (leaf.kind !== 'atomic') {
      return NO_MATCH;
    }

    const value = leaf.pointer.toString();

    return requiring(
      fields.find(({ unit }) => unit.path === value),
      this.reason(
        'atomicValue',
        `${this.selector.path} is inside the atomic value ${value} of ${this.address}`,
      ),
    );
  }

  private requireStructureOfChangedFields(): SelectorMatch {
    const touchesChangedField = this.structure.changedPointers.some(
      (pointer) =>
        pointer.isAtOrAbove(this.path) || this.path.isAtOrAbove(pointer),
    );

    if (!touchesChangedField) {
      return NO_MATCH;
    }

    return requiring(
      this.lookup.tableUnitOf('structure', this.table),
      this.reason(
        'structureBoundData',
        `${this.address}${this.selector.path} touches a new or changed field; its values belong to the structure of ${this.selector.tableId}`,
      ),
    );
  }

  private notSelectable(): PlanBlocker {
    const { tableId, rowId, path } = this.selector;

    return {
      code: 'notSelectable',
      tableId,
      rowId,
      path,
      message: `${this.address}${path} is a computed value that follows its inputs`,
    };
  }

  private reason(code: RequiredReasonCode, because: string): Reason {
    const { tableId, rowId, path } = this.selector;

    return { code, tableId, rowId, path, because };
  }
}

function pointerOf({ unit }: CatalogueUnit): JsonPointer {
  return JsonPointer.parse(unit.path ?? '');
}
