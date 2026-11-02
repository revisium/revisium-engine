import { obj, str } from '@revisium/schema-toolkit/mocks';
import type { Row } from 'src/engine-prisma-types';
import {
  buildChangeCatalogue,
  type CatalogueSource,
} from 'src/features/partial-changes/catalogue/change-catalogue';
import { HeadViewsMigration } from 'src/features/partial-changes/catalogue/head-views-migration';
import { checkHeadSchema } from 'src/features/partial-changes/head-schema/head-schema-check';
import type {
  ChangesSnapshot,
  RowPair,
  SystemTableRows,
  TableVersion,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import { attributeLedger } from 'src/features/partial-changes/snapshot/ledger-attribution';
import { SourceReplays } from 'src/features/partial-changes/snapshot/source-replays';
import {
  refs,
  replayer,
  validator,
} from 'src/features/share/ledger-replay/__tests__/support/ledger-steps';
import { NativeSchemaRules } from 'src/features/share/ledger-replay/native-schema-rules';
import { ViewsMigrationService } from 'src/features/share/views-migration.service';
import { analyzeStructure } from '../../structure/__tests__/support/table-structure-scenario';

const TABLE_IDENTITY = 'products-identity';
const ROW_COUNT = 50_000;
const EDITED_FIELDS = ['code', 'title', 'color'];
const WRITTEN_AT = new Date('2026-10-31T00:00:00.000Z');

const productSchema = obj({ code: str(), title: str(), color: str() });

describe('ChangeCatalogue: size', () => {
  it('builds the catalogue of a table with 50,000 rows and three edited fields per row', () => {
    const catalogue = buildChangeCatalogue(
      givenEditedRows(ROW_COUNT),
      new HeadViewsMigration(
        new ViewsMigrationService(),
        new NativeSchemaRules(refs, validator),
      ),
    );

    expect(catalogue.units).toHaveLength(ROW_COUNT * EDITED_FIELDS.length);
  });
});

function givenEditedRows(rowCount: number): CatalogueSource {
  const pairs = Array.from({ length: rowCount }, (_, index) =>
    editedRowPair(`row-${index}`),
  );

  const snapshot: ChangesSnapshot = {
    branchId: 'branch',
    headRevisionId: 'head',
    draftRevisionId: 'draft',
    tables: [
      {
        identity: TABLE_IDENTITY,
        head: tableVersion('head-table'),
        draft: tableVersion('draft-table'),
      },
    ],
    systemRows: {
      schemas: noRows(),
      migrations: noRows(),
      views: noRows(),
      sharedSchemas: noRows(),
    },
  };

  return {
    snapshot,
    ledger: attributeLedger(snapshot),
    headSchema: checkHeadSchema({
      snapshot,
      replays: new SourceReplays(snapshot, replayer),
      wholeDraft: true,
    }),
    tables: [
      {
        identity: TABLE_IDENTITY,
        headVersionId: 'head-table',
        draftVersionId: 'draft-table',
        structure: analyzeStructure({
          head: productSchema,
          draft: productSchema,
        }),
      },
    ],
    changedRows: new Map([[TABLE_IDENTITY, pairs]]),
  };
}

function editedRowPair(rowId: string): RowPair {
  return {
    identity: rowId,
    head: rowVersion(rowId, 'head', 'before'),
    draft: rowVersion(rowId, 'draft', 'after'),
  };
}

function rowVersion(rowId: string, side: string, value: string): Row {
  return {
    versionId: `${side}-${rowId}`,
    createdId: rowId,
    id: rowId,
    readonly: side === 'head',
    createdAt: WRITTEN_AT,
    updatedAt: WRITTEN_AT,
    publishedAt: WRITTEN_AT,
    data: Object.fromEntries(EDITED_FIELDS.map((field) => [field, value])),
    meta: {},
    hash: value,
    schemaHash: 'schema',
  };
}

function tableVersion(versionId: string): TableVersion {
  return {
    versionId,
    createdId: TABLE_IDENTITY,
    id: 'products',
    readonly: false,
    schema: productSchema,
    history: [],
  };
}

function noRows(): SystemTableRows {
  return { head: [], draft: [], versions: {} };
}
