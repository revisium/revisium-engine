import { obj, str } from '@revisium/schema-toolkit/mocks';
import type {
  NewRowVersion,
  TableWritePlan,
} from 'src/features/draft-revision/commands/impl';
import type { SystemTablePlan } from 'src/features/partial-changes/assembly/system-table-plans';
import type { TablePlan } from 'src/features/partial-changes/assembly/target-assembler';
import type { TablePair } from 'src/features/partial-changes/snapshot/changes-snapshot';
import { SystemTables } from 'src/features/share/system-tables.consts';
import {
  targetWritePlanOf,
  type WritableTarget,
} from '../target-write-plan-mapping';

// Only the fields that no operation-level test observes when they are mapped wrongly: the commit, revert and
// property suites guard every other field of the write plan.

const titleSchema = obj({ title: str() });

const renamedProducts: TablePair = {
  identity: 'products-identity',
  head: {
    versionId: 'products-head',
    createdId: 'products-identity',
    id: 'products',
    readonly: true,
    schema: titleSchema,
    history: [],
  },
  draft: {
    versionId: 'goods-draft',
    createdId: 'products-identity',
    id: 'goods',
    readonly: false,
    schema: titleSchema,
    history: [],
  },
};

const mergedView: NewRowVersion = {
  createdId: 'goods-views-created',
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  id: 'goods',
  data: { version: 1 },
  hash: 'views-hash',
  schemaHash: 'views-schema-hash',
  publishedAt: new Date('2026-10-01T00:00:00.000Z'),
  meta: null,
};

describe('targetWritePlanOf', () => {
  it('writes a mixed user table under its identity with the public id of its structure side, edited in place and not relinked', () => {
    const plan = targetWritePlanOf(
      writableTargetOf({
        tables: [
          {
            identity: renamedProducts.identity,
            outcome: 'mixed',
            structureSide: 'draft',
            versionId: 'goods-draft',
            editInPlace: true,
            relinkCandidate: false,
            rows: [],
            removedRowVersionIds: [],
            addedRowVersionIds: [],
            newRows: [],
          },
        ],
      }),
    );

    expect(plan.tables).toEqual<TableWritePlan[]>([
      {
        identity: 'products-identity',
        headVersionId: 'products-head',
        draftVersionId: 'goods-draft',
        target: {
          kind: 'mixed',
          tableId: 'goods',
          sourceVersionId: 'goods-draft',
          editInPlace: true,
          hasFileFields: false,
          removedRowVersionIds: [],
          addedRowVersionIds: [],
          newRows: [],
        },
        relinkCandidate: false,
      },
    ]);
  });

  it('writes each system table under its own id: a mixed one with its new rows and no files, edited in place and relinked, a linked one not relinked', () => {
    const plan = targetWritePlanOf(
      writableTargetOf({
        systemTables: [
          {
            tableId: SystemTables.Views,
            versionIds: { head: 'views-head', draft: 'views-draft' },
            outcome: 'mixed',
            linkSide: 'draft',
            versionId: 'views-draft',
            editInPlace: true,
            relinkCandidate: true,
            removedRowVersionIds: ['goods-views-draft'],
            addedRowVersionIds: [],
            newRows: [mergedView],
          },
          {
            tableId: SystemTables.Migration,
            versionIds: { head: 'migration-head', draft: 'migration-draft' },
            outcome: 'base',
            linkSide: 'head',
            versionId: 'migration-head',
            editInPlace: false,
            relinkCandidate: false,
            removedRowVersionIds: [],
            addedRowVersionIds: [],
            newRows: [],
          },
        ],
      }),
    );

    expect(plan.tables).toEqual<TableWritePlan[]>([
      {
        identity: SystemTables.Views,
        headVersionId: 'views-head',
        draftVersionId: 'views-draft',
        target: {
          kind: 'mixed',
          tableId: SystemTables.Views,
          sourceVersionId: 'views-draft',
          editInPlace: true,
          hasFileFields: false,
          removedRowVersionIds: ['goods-views-draft'],
          addedRowVersionIds: [],
          newRows: [mergedView],
        },
        relinkCandidate: true,
      },
      {
        identity: SystemTables.Migration,
        headVersionId: 'migration-head',
        draftVersionId: 'migration-draft',
        target: { kind: 'linked', versionId: 'migration-head' },
        relinkCandidate: false,
      },
    ]);
  });
});

function writableTargetOf({
  tables = [],
  systemTables = [],
}: {
  readonly tables?: readonly TablePlan[];
  readonly systemTables?: readonly SystemTablePlan[];
}): WritableTarget {
  return {
    source: {
      snapshot: {
        branchId: 'branch',
        headRevisionId: 'head-revision',
        draftRevisionId: 'draft-revision',
        tables: [renamedProducts],
      },
    },
    assembled: { tables, systemTables, ledger: { renumbered: [] } },
  };
}
