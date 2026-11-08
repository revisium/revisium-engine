import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Row } from 'src/engine-prisma-types';
import {
  OutcomeRules,
  type TableOutcomeRules,
} from 'src/features/partial-changes/assembly/outcome-rules';
import {
  tableRulesOf,
  tableUnitsOf,
} from 'src/features/partial-changes/assembly/read-tables';
import {
  type CatalogueRow,
  type CatalogueUnit,
  isExistenceUnit,
} from 'src/features/partial-changes/catalogue/catalogue-unit';
import type { ChangeCatalogue } from 'src/features/partial-changes/catalogue/change-catalogue';
import type { UnitKind } from 'src/features/partial-changes/catalogue/unit';
import type { AppliedUnits } from 'src/features/partial-changes/plan/change-operation';
import {
  type ChangesSnapshot,
  type RowPair,
  type TablePair,
  type TableVersion,
  versionOn,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

export interface FingerprintedPlan extends AppliedUnits {
  readonly snapshot: ChangesSnapshot;
  readonly catalogue: Pick<
    ChangeCatalogue,
    'units' | 'rows' | 'tables' | 'lookup'
  >;
}

interface CoveredReads {
  readonly rowTexts: ReadonlyMap<string, string>;
  readonly rowDigests: ReadonlyMap<string, string>;
}

type FingerprintRecord = readonly unknown[];

const NON_ROW_UNIT_KINDS: ReadonlySet<UnitKind> = new Set([
  'structure',
  'views',
  'sharedSchema',
]);

@Injectable()
export class PlanFingerprint {
  constructor(private readonly snapshotReader: ChangesSnapshotReader) {}

  public async fingerprintOf(plan: FingerprintedPlan): Promise<string> {
    const coverage = new PlanCoverage(plan);
    const reads: CoveredReads = {
      rowTexts: await this.readRowTexts(coverage.rowVersionIdGroups()),
      rowDigests: await this.readRowDigests(coverage.digestedTableVersions()),
    };
    const hash = createHash('sha256');

    for (const record of coverage.recordsOf(reads)) {
      hash.update(`${JSON.stringify(record)}\n`);
    }

    return hash.digest('hex');
  }

  private async readRowTexts(
    versionIdGroups: readonly (readonly string[])[],
  ): Promise<ReadonlyMap<string, string>> {
    const texts = new Map<string, string>();

    for (const versionIds of versionIdGroups) {
      const tableTexts =
        await this.snapshotReader.readRowVersionTexts(versionIds);

      for (const [versionId, text] of tableTexts) {
        texts.set(versionId, text);
      }
    }

    return texts;
  }

  private async readRowDigests(
    tableVersionIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const digests = new Map<string, string>();

    for (const tableVersionId of tableVersionIds) {
      digests.set(
        tableVersionId,
        await this.snapshotReader.readRowDigest(tableVersionId),
      );
    }

    return digests;
  }
}

class PlanCoverage {
  private readonly units: readonly CatalogueUnit[];
  private readonly tablePairs: ReadonlyMap<string, TablePair>;
  private readonly rows: ReadonlyMap<string, ReadonlyMap<string, CatalogueRow>>;
  private readonly rules: OutcomeRules;
  private readonly movedStructures: ReadonlyMap<string, string>;

  constructor(private readonly plan: FingerprintedPlan) {
    this.units = plan.catalogue.units.filter(({ key }) =>
      plan.applied.has(key),
    );
    this.tablePairs = new Map(
      plan.snapshot.tables.map((pair) => [pair.identity, pair]),
    );
    this.rows = new Map(
      [...plan.catalogue.rows].map(([identity, rows]) => [
        identity,
        new Map(rows.map((row) => [row.pair.identity, row])),
      ]),
    );
    this.rules = new OutcomeRules(plan);
    this.movedStructures = this.structuresOfMovingUnits();
  }

  public rowVersionIdGroups(): string[][] {
    return [
      ...this.coveredRowVersionIdsByTable(),
      this.ownedSystemRowVersionIds(),
    ].filter((versionIds) => versionIds.length > 0);
  }

  public digestedTableVersions(): string[] {
    return this.units
      .filter(({ unit }) => unit.kind === 'structure')
      .flatMap((unit) => this.tablePairsOf(unit))
      .flatMap(({ draft }) => (isMutable(draft) ? [draft.versionId] : []));
  }

  public recordsOf(reads: CoveredReads): FingerprintRecord[] {
    const { operation, snapshot } = this.plan;

    return [
      [operation, snapshot.headRevisionId, snapshot.draftRevisionId],
      ...this.units.map((unit) => this.recordOf(unit, reads)),
    ];
  }

  private recordOf(
    unit: CatalogueUnit,
    reads: CoveredReads,
  ): FingerprintRecord {
    if (isRowUnit(unit)) {
      return this.rowUnitRecordOf(unit, reads);
    }

    return this.tableUnitRecordOf(unit, reads);
  }

  private rowUnitRecordOf(
    unit: CatalogueUnit,
    reads: CoveredReads,
  ): FingerprintRecord {
    return [
      unit.key,
      unit.unit.columns ?? null,
      this.movedStructures.get(unit.key) ?? null,
      this.coveredRowsOf(unit).map(({ pair: { head, draft } }) => [
        textOf(reads, head),
        textOf(reads, draft),
      ]),
    ];
  }

  private tableUnitRecordOf(
    unit: CatalogueUnit,
    reads: CoveredReads,
  ): FingerprintRecord {
    return [
      unit.key,
      this.tablePairsOf(unit).map((pair) => tableVersionsOf(unit, pair, reads)),
      [...unit.systemRows]
        .sort((left, right) =>
          compareCodePoints(left.versionId, right.versionId),
        )
        .map((row) => textOf(reads, row)),
    ];
  }

  private coveredRowVersionIdsByTable(): string[][] {
    const versionIds = new Map<string, Set<string>>();

    for (const unit of this.units.filter(isRowUnit)) {
      const tableIdentity = tableIdentityOf(unit);
      const tableVersionIds = versionIds.get(tableIdentity) ?? new Set();
      const coveredVersionIds = this.coveredRowsOf(unit).flatMap(({ pair }) =>
        rowVersionIdsOf(pair),
      );

      for (const versionId of coveredVersionIds) {
        tableVersionIds.add(versionId);
      }

      versionIds.set(tableIdentity, tableVersionIds);
    }

    return [...versionIds.values()].map((ids) => [...ids]);
  }

  private ownedSystemRowVersionIds(): string[] {
    const versionIds = this.units.flatMap(({ systemRows }) =>
      systemRows.map(({ versionId }) => versionId),
    );

    return [...new Set(versionIds)];
  }

  private coveredRowsOf(unit: CatalogueUnit): CatalogueRow[] {
    const rows = this.rows.get(tableIdentityOf(unit));

    return unit.rowIdentities.map((rowIdentity) => {
      const row = rows?.get(rowIdentity);

      if (!row) {
        throw new Error(`Row ${rowIdentity} of ${unit.key} was not read`);
      }

      return row;
    });
  }

  private structuresOfMovingUnits(): Map<string, string> {
    const structures = new Map<string, string>();

    for (const [identity, units] of existenceUnitsByTable(this.units)) {
      const movingUnits = this.unitsMovingRows(identity, units);

      if (movingUnits.length === 0) {
        continue;
      }

      const movedBetween = this.structuresOfTable(identity);

      for (const { key } of movingUnits) {
        structures.set(key, movedBetween);
      }
    }

    return structures;
  }

  private unitsMovingRows(
    identity: string,
    units: readonly CatalogueUnit[],
  ): CatalogueUnit[] {
    const rules = this.rulesOfTable(identity);

    return units.filter((unit) =>
      this.coveredRowsOf(unit).some(
        (row) => rules.rowOutcomeOf(row).kind === 'move',
      ),
    );
  }

  private rulesOfTable(identity: string): TableOutcomeRules {
    const { tables, lookup } = this.plan.catalogue;
    const pair = tables.pairOf(identity);

    return tableRulesOf(this.rules, {
      units: tableUnitsOf(pair, lookup),
      structure: tables.structureOf(pair),
    });
  }

  private structuresOfTable(identity: string): string {
    const { tables } = this.plan.catalogue;
    const pair = tables.pairOf(identity);
    const structure = tables.structureOf(pair);

    return digestOf([
      versionOn(pair, 'head').schema,
      versionOn(pair, 'draft').schema,
      structure.pendingHistory,
      structure.unchangedLeaves.map(({ pointer }) => pointer.toString()),
    ]);
  }

  private tablePairsOf({ tableIdentities }: CatalogueUnit): TablePair[] {
    return tableIdentities.flatMap((identity) => {
      const pair = this.tablePairs.get(identity);

      return pair ? [pair] : [];
    });
  }
}

function isRowUnit({ unit }: CatalogueUnit): boolean {
  return !NON_ROW_UNIT_KINDS.has(unit.kind);
}

function existenceUnitsByTable(
  units: readonly CatalogueUnit[],
): Map<string, CatalogueUnit[]> {
  const byTable = new Map<string, CatalogueUnit[]>();

  for (const unit of units.filter(isExistenceUnit)) {
    const tableIdentity = tableIdentityOf(unit);
    const tableUnits = byTable.get(tableIdentity) ?? [];

    tableUnits.push(unit);
    byTable.set(tableIdentity, tableUnits);
  }

  return byTable;
}

function tableIdentityOf({ key, tableIdentities }: CatalogueUnit): string {
  const [tableIdentity] = tableIdentities;

  if (tableIdentity === undefined) {
    throw new Error(`Row unit ${key} has no table`);
  }

  return tableIdentity;
}

function tableVersionsOf(
  { unit }: CatalogueUnit,
  { head, draft }: TablePair,
  reads: CoveredReads,
): (string | null)[] {
  const versionIds = [head?.versionId ?? null, draft?.versionId ?? null];

  if (unit.kind !== 'structure' || !isMutable(draft)) {
    return versionIds;
  }

  return [...versionIds, rowDigestOf(reads, draft)];
}

function rowVersionIdsOf({ head, draft }: RowPair): string[] {
  return [head, draft].flatMap((version) =>
    version ? [version.versionId] : [],
  );
}

function rowDigestOf(reads: CoveredReads, { versionId }: TableVersion): string {
  const digest = reads.rowDigests.get(versionId);

  if (digest === undefined) {
    throw new Error(`The rows of table version ${versionId} were not digested`);
  }

  return digest;
}

function textOf(
  reads: CoveredReads,
  version: Pick<Row, 'versionId'> | undefined,
): string | null {
  if (!version) {
    return null;
  }

  const text = reads.rowTexts.get(version.versionId);

  if (text === undefined) {
    throw new Error(`Row version ${version.versionId} was not read`);
  }

  return text;
}

function digestOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isMutable(version: TableVersion | undefined): version is TableVersion {
  return version !== undefined && !version.readonly;
}
