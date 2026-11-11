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
  draftFollowsHeadPlanOf,
  targetWritePlanOf,
  type WritableTarget,
} from '../target-write-plan-mapping';

// Only the fields that no operation-level test observes when they are mapped wrongly: the commit, revert,
// normalisation and property suites guard every other field of the write plans.

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

const createdTags: TablePair = {
  identity: 'tags-identity',
  draft: {
    versionId: 'tags-draft',
    createdId: 'tags-identity',
    id: 'tags',
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

describe('draftFollowsHeadPlanOf', () => {
  it('offers every read user and system table whose Head and Draft versions differ to relink under its identity, keeping its Draft version, and leaves out a table of one side only', () => {
    const plan = draftFollowsHeadPlanOf(
      writableTargetOf({
        pairs: [renamedProducts, createdTags],
        tables: [
          linkedTableOf(renamedProducts.identity, 'goods-draft'),
          linkedTableOf(createdTags.identity, 'tags-draft'),
        ],
        systemTables: [
          {
            tableId: SystemTables.Views,
            versionIds: { head: 'views-head', draft: 'views-draft' },
            outcome: 'other',
            linkSide: 'draft',
            versionId: 'views-draft',
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
        identity: 'products-identity',
        headVersionId: 'products-head',
        draftVersionId: 'goods-draft',
        target: { kind: 'linked', versionId: 'goods-draft' },
        relinkCandidate: true,
      },
      {
        identity: SystemTables.Views,
        headVersionId: 'views-head',
        draftVersionId: 'views-draft',
        target: { kind: 'linked', versionId: 'views-draft' },
        relinkCandidate: true,
      },
    ]);
  });
});

function linkedTableOf(identity: string, versionId: string): TablePlan {
  return {
    identity,
    outcome: 'other',
    structureSide: 'draft',
    versionId,
    editInPlace: false,
    relinkCandidate: false,
    rows: [],
    removedRowVersionIds: [],
    addedRowVersionIds: [],
    newRows: [],
  };
}

function writableTargetOf({
  pairs = [renamedProducts],
  tables = [],
  systemTables = [],
}: {
  readonly pairs?: readonly TablePair[];
  readonly tables?: readonly TablePlan[];
  readonly systemTables?: readonly SystemTablePlan[];
}): WritableTarget {
  return {
    source: {
      snapshot: {
        branchId: 'branch',
        headRevisionId: 'head-revision',
        draftRevisionId: 'draft-revision',
        tables: pairs,
      },
    },
    assembled: { tables, systemTables, ledger: { renumbered: [] } },
  };
}
