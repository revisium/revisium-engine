import type { Row } from 'src/engine-prisma-types';
import type {
  CatalogueRow,
  CatalogueUnit,
} from 'src/features/partial-changes/catalogue/catalogue-unit';
import { fieldUnitKey } from 'src/features/partial-changes/catalogue/unit-key';
import {
  type FingerprintedPlan,
  PlanFingerprint,
} from 'src/features/partial-changes/planning/plan-fingerprint';
import type { SystemTableRows } from 'src/features/partial-changes/snapshot/changes-snapshot';
import type { ChangesSnapshotReader } from 'src/features/partial-changes/snapshot/changes-snapshot-reader.service';
import { JsonPointer } from 'src/features/partial-changes/structure/json-pointer';

const UNIT_COUNT = 50_000;
const CPU_GUARD_IN_MS = 5_000;
const QUADRATIC_RUN_TIMEOUT_IN_MS = 120_000;
const TABLE_IDENTITY = 'products-identity';
const TITLE = JsonPointer.parse('/title');
const WRITTEN_AT = new Date('2026-11-01T00:00:00.000Z');

describe('PlanFingerprint: size', () => {
  it(
    'fingerprints 50,000 applied field units of one table in linear time',
    async () => {
      const plan = givenAppliedFieldUnits(UNIT_COUNT);
      const fingerprint = new PlanFingerprint(readerFromMemory());

      const started = performance.now();
      await fingerprint.fingerprintOf(plan);
      const elapsed = performance.now() - started;

      expect(elapsed).toBeLessThan(CPU_GUARD_IN_MS);
    },
    QUADRATIC_RUN_TIMEOUT_IN_MS,
  );
});

function givenAppliedFieldUnits(count: number): FingerprintedPlan {
  const rows = Array.from({ length: count }, (_, index) =>
    editedRow(`row-${index}`),
  );
  const units = rows.map(({ pair }) => titleUnitOf(pair.identity));

  return {
    operation: 'commit',
    snapshot: {
      branchId: 'branch',
      headRevisionId: 'head',
      draftRevisionId: 'draft',
      tables: [],
      systemRows: {
        schemas: noRows(),
        migrations: noRows(),
        views: noRows(),
        sharedSchemas: noRows(),
      },
    },
    catalogue: {
      units,
      rows: new Map([[TABLE_IDENTITY, rows]]),
      ledgerInconsistencies: [],
      refusedTables: [],
    },
    applied: new Set(units.map(({ key }) => key)),
  };
}

function editedRow(rowId: string): CatalogueRow {
  return {
    pair: {
      identity: rowId,
      head: rowVersion(rowId, 'head'),
      draft: rowVersion(rowId, 'draft'),
    },
    columns: new Map(),
    leaves: new Map([[TITLE.toString(), titleUnitOf(rowId).key]]),
  };
}

function titleUnitOf(rowId: string): CatalogueUnit {
  return {
    key: fieldUnitKey(TABLE_IDENTITY, rowId, TITLE),
    tableIdentities: [TABLE_IDENTITY],
    rowIdentities: [rowId],
    systemRows: [],
    unit: {
      kind: 'field',
      tableId: 'products',
      rowId,
      path: TITLE.toString(),
    },
  };
}

function rowVersion(rowId: string, side: string): Row {
  return {
    versionId: `${side}-${rowId}`,
    createdId: rowId,
    id: rowId,
    readonly: side === 'head',
    createdAt: WRITTEN_AT,
    updatedAt: WRITTEN_AT,
    publishedAt: WRITTEN_AT,
    data: { title: side },
    meta: {},
    hash: side,
    schemaHash: 'schema',
  };
}

function readerFromMemory(): ChangesSnapshotReader {
  const reader: Pick<
    ChangesSnapshotReader,
    'readRowVersionTexts' | 'readRowDigest'
  > = {
    readRowVersionTexts: (versionIds) =>
      Promise.resolve(
        new Map(versionIds.map((versionId) => [versionId, versionId])),
      ),
    readRowDigest: () => Promise.resolve(''),
  };

  return reader as ChangesSnapshotReader;
}

function noRows(): SystemTableRows {
  return { head: [], draft: [], versionIds: {} };
}
