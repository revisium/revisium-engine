import { Injectable } from '@nestjs/common';
import { getForeignKeysFromSchema } from '@revisium/schema-toolkit/lib';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import {
  TargetState,
  TargetTable,
  ViewsTarget,
} from 'src/features/partial-changes-poc/assembly/target.types';
import {
  ChangeCatalogue,
  schemaOfSide,
} from 'src/features/partial-changes-poc/catalogue/change-catalogue.types';
import { RowLookup } from 'src/features/partial-changes-poc/dependencies/row-lookup.service';
import {
  IndexedTable,
  TargetIndex,
} from 'src/features/partial-changes-poc/dependencies/target-index';
import {
  Finding,
  sideNamesOf,
  TargetConsistencyChecks,
  unitOrBlocker,
} from 'src/features/partial-changes-poc/dependencies/target-consistency-checks.service';
import {
  ChangesSnapshot,
  sideOf,
} from 'src/features/partial-changes-poc/snapshot/snapshot.types';
import { ViewsProjection } from 'src/features/partial-changes-poc/views/views-projection.service';
import { JsonSchemaStoreService } from 'src/features/share/json-schema-store.service';
import { getForeignKeyJsonPaths } from 'src/features/share/utils/get-foreign-key-json-paths';
import type { TableViewsData } from 'src/features/views/types';

export interface StructureCheckInput {
  snapshot: ChangesSnapshot;
  catalogue: ChangeCatalogue;
  state: TargetState;
  applied: ReadonlySet<string>;
}

@Injectable()
export class StructureConsistencyChecks {
  constructor(
    private readonly jsonSchemaStore: JsonSchemaStoreService,
    private readonly rowLookup: RowLookup,
    private readonly rowChecks: TargetConsistencyChecks,
    private readonly viewsProjection: ViewsProjection,
  ) {}

  async find(input: StructureCheckInput): Promise<Finding[]> {
    const userTables = input.state.tables.filter(
      (target) =>
        target.table.kind !== 'system' &&
        target.outcome !== 'absent' &&
        target.publicId !== undefined,
    );

    return [
      ...this.tableIdCollisions(userTables, input),
      ...this.missingReferencedTables(userTables, input),
      ...(await this.viewsThatDoNotFit(input)),
      ...(await this.referencesOfWholesaleRows(input)),
    ];
  }

  private tableIdCollisions(
    tables: TargetTable[],
    input: StructureCheckInput,
  ): Finding[] {
    const byId = new Map<string, TargetTable[]>();
    for (const target of tables) {
      const id = target.publicId ?? '';
      byId.set(id, [...(byId.get(id) ?? []), target]);
    }

    const { base } = input.state.direction;
    return [...byId]
      .filter(([, group]) => group.length > 1)
      .flatMap(([id, group]) =>
        group
          .filter((target) => sideOf(target.table.pair, base)?.id === id)
          .filter(
            (target) =>
              !target.table.structureUnit ||
              !input.applied.has(target.table.structureUnit),
          )
          .map((target) =>
            unitOrBlocker(target.table.structureUnit, {
              code: 'idOccupied',
              tableId: id,
              because: `table id ${id} would be held by two tables; ${id} still keeps it and has to move as well`,
            }),
          ),
      );
  }

  private missingReferencedTables(
    tables: TargetTable[],
    input: StructureCheckInput,
  ): Finding[] {
    const ids = new Set(tables.map((target) => target.publicId ?? ''));
    const names = sideNamesOf(input.state);

    return tables.flatMap((target) =>
      this.foreignKeyTables(target.schema)
        .filter((referenced) => referenced !== target.publicId)
        .filter((referenced) => !ids.has(referenced))
        .map((referenced) =>
          this.fixMissingTable(target, referenced, input, names),
        ),
    );
  }

  private fixMissingTable(
    referrer: TargetTable,
    referenced: string,
    input: StructureCheckInput,
    names: { target: string; other: string },
  ): Finding {
    const { other } = input.state.direction;
    const referrerUnit = referrer.table.structureUnit;
    const otherSchema = schemaOfSide(referrer.table.pair, other);
    const otherReferences = this.foreignKeyTables(otherSchema);

    if (
      referrerUnit &&
      !input.applied.has(referrerUnit) &&
      !otherReferences.includes(referenced)
    ) {
      return {
        type: 'require',
        unit: referrerUnit,
        reason: {
          code: 'referrerStillReferences',
          tableId: referrer.publicId ?? '',
          because: `the structure of ${referrer.publicId} still references table ${referenced}, which the ${names.target} does not contain; its ${names.other} structure has to be taken as well`,
        },
      };
    }

    const provider = [...input.catalogue.tables.values()].find(
      (table) =>
        table.structureUnit &&
        !input.applied.has(table.structureUnit) &&
        sideOf(table.pair, other)?.id === referenced,
    );
    return unitOrBlocker(provider?.structureUnit, {
      code: 'referencedTableMissing',
      tableId: referenced,
      because: `the structure of ${referrer.publicId} references table ${referenced}, which exists only in the ${names.other}`,
    });
  }

  private async viewsThatDoNotFit(
    input: StructureCheckInput,
  ): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const views of input.state.views) {
      if (views.doc && !(await this.viewsFit(views.doc, views, input))) {
        findings.push(this.fixViews(views, input));
      }
    }
    return findings;
  }

  private viewsFit(
    doc: TableViewsData,
    views: ViewsTarget,
    input: StructureCheckInput,
  ): Promise<boolean> {
    const { snapshot } = input;
    const side = views.structureSide;
    const revisionId =
      side === 'head' ? snapshot.headRevisionId : snapshot.draftRevisionId;
    const tableId = sideOf(views.table.pair, side)?.id ?? views.publicId;
    return this.viewsProjection.fits(doc, revisionId, tableId);
  }

  private fixViews(views: ViewsTarget, input: StructureCheckInput): Finding {
    const { structureUnit, viewsUnit } = views.table;
    const candidate = [viewsUnit, structureUnit].find(
      (unit) => unit !== undefined && !input.applied.has(unit),
    );
    const reason = {
      code: 'viewsDoNotFitStructure' as const,
      tableId: views.publicId,
      because: `the ${views.viewsSide} views of ${views.publicId} do not fit its ${views.structureSide} structure`,
    };

    if (views.viewsSide === views.structureSide || !candidate) {
      return {
        type: 'blocker',
        blocker: {
          code: 'invalidViews',
          tableId: views.publicId,
          message: `The views of ${views.publicId} are invalid for its structure`,
        },
      };
    }

    return { type: 'require', unit: candidate, reason };
  }

  private async referencesOfWholesaleRows(
    input: StructureCheckInput,
  ): Promise<Finding[]> {
    const index = new TargetIndex(input.state);
    const findings: Finding[] = [];

    for (const source of index.tables) {
      if (!this.bringsOtherRowsWholesale(source, input)) {
        continue;
      }
      findings.push(...(await this.wholesaleReferences(index, source)));
    }

    return findings;
  }

  private bringsOtherRowsWholesale(
    source: IndexedTable,
    input: StructureCheckInput,
  ): boolean {
    const { target } = source;
    const { other } = input.state.direction;
    if (target.table.kind === 'whole') {
      return target.linkSide === other;
    }
    return (
      target.linkSide === other &&
      target.table.changedPointers.length > 0 &&
      this.foreignKeyTables(target.schema).length > 0
    );
  }

  private async wholesaleReferences(
    index: TargetIndex,
    source: IndexedTable,
  ): Promise<Finding[]> {
    const loaded = [...source.target.table.rows.keys()];
    const findings: Finding[] = [];
    const names = sideNamesOf(index.state);

    for (const referencedId of this.foreignKeyTables(source.schema)) {
      const referenced = index.table(referencedId);
      if (!referenced || !source.schema) {
        continue;
      }
      for (const jsonPath of getForeignKeyJsonPaths(
        this.jsonSchemaStore.create(source.schema),
        referencedId,
      )) {
        const values = await this.rowLookup.referencedValues(
          source.version.versionId,
          jsonPath,
          loaded,
        );
        const missing = await this.missingIds(
          referenced,
          values.map(({ value }) => value),
        );
        findings.push(
          ...values
            .filter(({ value }) => missing.has(value))
            .map(({ value, rowId }) =>
              unitOrBlocker(
                this.rowChecks.providerUnit(index, referencedId, value),
                {
                  code: 'referencedRowMissing',
                  tableId: referencedId,
                  rowId: value,
                  because: `${source.publicId}/${rowId} references ${referencedId}/${value}, which exists only in the ${names.other}`,
                },
              ),
            ),
        );
      }
    }

    return findings;
  }

  private async missingIds(
    referenced: IndexedTable,
    ids: string[],
  ): Promise<Set<string>> {
    const untouched = ids.filter((id) => !referenced.touchedIds.has(id));
    const existing = await this.rowLookup.findExistingIds(
      referenced.version.versionId,
      untouched,
    );
    return new Set(
      ids.filter((id) =>
        referenced.touchedIds.has(id)
          ? !referenced.resultIds.has(id)
          : !existing.has(id),
      ),
    );
  }

  private foreignKeyTables(schema: JsonSchema | undefined): string[] {
    if (!schema) {
      return [];
    }
    return getForeignKeysFromSchema(this.jsonSchemaStore.create(schema));
  }
}
