import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { arr, obj, ref, str } from '@revisium/schema-toolkit/mocks';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type { Migration } from '@revisium/schema-toolkit/types';
import type { Row } from 'src/engine-prisma-types';
import type {
  CommitTableWritePlan,
  CommitTargetWritePlan,
  NewRowVersion,
  RevisionSide,
  TableWritePlan,
} from 'src/features/draft-revision/commands/impl';
import type { RenumberedMigrationRow } from 'src/features/partial-changes/assembly/ledger-plan';
import type { TableOutcome } from 'src/features/partial-changes/assembly/outcome-rules';
import type { MergedRow } from 'src/features/partial-changes/assembly/row-merger';
import type { SystemTablePlan } from 'src/features/partial-changes/assembly/system-target-assembler';
import type { TablePlan } from 'src/features/partial-changes/assembly/target-assembler';
import type {
  TablePair,
  TableVersion,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import { SystemTables } from 'src/features/share/system-tables.consts';
import {
  commitTargetWritePlanOf,
  targetWritePlanOf,
  type WritableTarget,
} from '../target-write-plan-mapping';

const BRANCH = 'branch';
const HEAD_REVISION = 'head-revision';
const DRAFT_REVISION = 'draft-revision';

const titleSchema = obj({ title: str() });
const documentSchema = obj({ title: str(), image: ref(SystemSchemaIds.File) });
const gallerySchema = obj({ images: arr(ref(SystemSchemaIds.File)) });
const coverSchema = obj({ cover: obj({ image: ref(SystemSchemaIds.File) }) });

const products = tablePairOf('products', {
  head: titleSchema,
  draft: titleSchema,
});
const createdTags = tablePairOf('tags', { draft: titleSchema });

const mergedP2: MergedRow = {
  createdId: 'p2-created',
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  id: 'p2',
  data: { title: 'merged' },
  hash: 'merged-hash',
  schemaHash: 'schema-hash',
  publishedAt: new Date('2026-10-01T00:00:00.000Z'),
  meta: null,
};

describe('targetWritePlanOf', () => {
  it('writes the Draft the plan was made on against its Head', () => {
    const plan = targetWritePlanOf(writableTargetOf({}));

    expect(plan).toEqual({
      headRevisionId: HEAD_REVISION,
      draftRevisionId: DRAFT_REVISION,
      tables: [],
    });
  });

  describe('user tables', () => {
    it('writes a mixed table from its structure-side version with its public id, its link changes, whether it is edited in place and whether it is a relink candidate', () => {
      const plan = targetWritePlanOf(
        writableTargetOf({
          pairs: [products],
          tables: [
            tablePlanOf(products, {
              outcome: 'mixed',
              structureSide: 'draft',
              versionId: 'products-draft',
              editInPlace: true,
              relinkCandidate: true,
              removedRowVersionIds: ['p1-draft', 'p2-draft'],
              addedRowVersionIds: ['p1-head'],
              newRows: [mergedP2],
            }),
          ],
        }),
      );

      expect(plan.tables).toEqual<TableWritePlan[]>([
        {
          identity: products.identity,
          headVersionId: 'products-head',
          draftVersionId: 'products-draft',
          target: {
            kind: 'mixed',
            tableId: 'products',
            sourceVersionId: 'products-draft',
            editInPlace: true,
            hasFileFields: false,
            removedRowVersionIds: ['p1-draft', 'p2-draft'],
            addedRowVersionIds: ['p1-head'],
            newRows: [mergedP2],
          },
          relinkCandidate: true,
        },
      ]);
    });

    it.each<TableOutcome>(['unchanged', 'base', 'other', 'absent', 'present'])(
      'links the planned version of a table assembled as %s',
      (outcome) => {
        const plan = targetWritePlanOf(
          writableTargetOf({
            pairs: [products],
            tables: [
              tablePlanOf(products, { outcome, versionId: 'products-head' }),
            ],
          }),
        );

        expect(plan.tables).toMatchObject([
          { target: { kind: 'linked', versionId: 'products-head' } },
        ]);
      },
    );

    it('writes a table that exists on one side only without a version on the other side', () => {
      const plan = targetWritePlanOf(
        writableTargetOf({
          pairs: [createdTags],
          tables: [
            tablePlanOf(createdTags, {
              outcome: 'absent',
              structureSide: 'head',
            }),
          ],
        }),
      );

      expect(plan.tables).toEqual([
        expect.objectContaining({
          identity: createdTags.identity,
          headVersionId: undefined,
          draftVersionId: 'tags-draft',
          target: { kind: 'linked', versionId: undefined },
        }),
      ]);
    });

    it.each<{ fields: string; schema: JsonSchema; hasFileFields: boolean }>([
      { fields: 'a File field', schema: documentSchema, hasFileFields: true },
      {
        fields: 'File fields in an array',
        schema: gallerySchema,
        hasFileFields: true,
      },
      {
        fields: 'a File field in a nested object',
        schema: coverSchema,
        hasFileFields: true,
      },
      { fields: 'no File field', schema: titleSchema, hasFileFields: false },
    ])(
      'registers the files of new rows when the structure-side schema has $fields: $hasFileFields',
      ({ schema, hasFileFields }) => {
        const documents = tablePairOf('documents', {
          head: schema,
          draft: schema,
        });

        const plan = targetWritePlanOf(
          writableTargetOf({
            pairs: [documents],
            tables: [tablePlanOf(documents, { outcome: 'mixed' })],
          }),
        );

        expect(plan.tables).toMatchObject([{ target: { hasFileFields } }]);
      },
    );

    it.each<{ structureSide: RevisionSide; hasFileFields: boolean }>([
      { structureSide: 'head', hasFileFields: true },
      { structureSide: 'draft', hasFileFields: false },
    ])(
      'reads File fields from the structure side only: $structureSide gives $hasFileFields',
      ({ structureSide, hasFileFields }) => {
        const documents = tablePairOf('documents', {
          head: documentSchema,
          draft: titleSchema,
        });

        const plan = targetWritePlanOf(
          writableTargetOf({
            pairs: [documents],
            tables: [
              tablePlanOf(documents, { outcome: 'mixed', structureSide }),
            ],
          }),
        );

        expect(plan.tables).toMatchObject([{ target: { hasFileFields } }]);
      },
    );
  });

  describe('system tables', () => {
    it('writes a system table on its link side with the versions of both sides, its link changes and no files', () => {
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
              relinkCandidate: false,
              removedRowVersionIds: ['products-views-draft'],
              addedRowVersionIds: ['products-views-head'],
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
            removedRowVersionIds: ['products-views-draft'],
            addedRowVersionIds: ['products-views-head'],
            newRows: [],
          },
          relinkCandidate: false,
        },
      ]);
    });
  });

  describe('commits', () => {
    it('writes a commit on the branch of the planned snapshot with its comment, each table on its Head side and the next Draft side of its relink candidates', () => {
      const plan = commitTargetWritePlanOf(
        writableTargetOf({
          pairs: [products],
          tables: [
            tablePlanOf(products, {
              outcome: 'mixed',
              structureSide: 'head',
              versionId: 'products-head',
              relinkCandidate: true,
              removedRowVersionIds: ['p2-head'],
              newRows: [mergedP2],
            }),
          ],
        }),
        'titles',
      );

      expect(plan).toEqual<CommitTargetWritePlan>({
        branchId: BRANCH,
        headRevisionId: HEAD_REVISION,
        draftRevisionId: DRAFT_REVISION,
        comment: 'titles',
        tables: [
          {
            identity: products.identity,
            headVersionId: 'products-head',
            draftVersionId: 'products-draft',
            target: {
              kind: 'mixed',
              tableId: 'products',
              sourceVersionId: 'products-head',
              editInPlace: false,
              hasFileFields: false,
              removedRowVersionIds: ['p2-head'],
              addedRowVersionIds: [],
              newRows: [mergedP2],
            },
            relinkCandidate: true,
          },
        ],
      });
    });

    it('writes a commit that takes the structure of a table from the Draft on its Draft side', () => {
      const plan = commitTargetWritePlanOf(
        writableTargetOf({
          pairs: [products],
          tables: [
            tablePlanOf(products, {
              outcome: 'base',
              structureSide: 'draft',
              versionId: 'products-draft',
            }),
          ],
        }),
      );

      expect(plan.tables).toEqual<CommitTableWritePlan[]>([
        expect.objectContaining({
          identity: products.identity,
          target: { kind: 'linked', versionId: 'products-draft' },
        }),
      ]);
    });

    it('writes the renumbered migrations into the next Draft version of the migration table, replacing their source rows', () => {
      const plan = commitTargetWritePlanOf(
        writableTargetOf({
          systemTables: [migrationTablePlan, viewsTablePlan],
          renumbered: [renumbered('2026-10-20T10:00:00.000Z')],
        }),
      );

      expect(plan.tables).toEqual<CommitTableWritePlan[]>([
        expect.objectContaining({
          identity: SystemTables.Migration,
          renumberedRows: {
            replacedRowVersionIds: ['2026-10-20T10:00:00.000Z-version'],
            newRows: [renumberedRow],
          },
        }),
        expect.not.objectContaining({ renumberedRows: expect.anything() }),
      ]);
    });

    it('writes no renumbered rows when nothing was renumbered', () => {
      const plan = commitTargetWritePlanOf(
        writableTargetOf({ systemTables: [migrationTablePlan] }),
      );

      expect(plan.tables).toEqual<CommitTableWritePlan[]>([
        expect.not.objectContaining({ renumberedRows: expect.anything() }),
      ]);
    });
  });
});

const renumberedRow: NewRowVersion = {
  createdId: 'migration-created',
  createdAt: new Date('2026-10-20T10:00:00.000Z'),
  id: '2026-10-22T14:03:12.418Z',
  data: { id: '2026-10-22T14:03:12.418Z' },
  hash: 'renumbered-hash',
  schemaHash: 'migration-schema-hash',
  publishedAt: new Date('2026-10-22T14:03:12.418Z'),
  meta: null,
};

const migrationTablePlan = systemTablePlanOf(SystemTables.Migration);
const viewsTablePlan = systemTablePlanOf(SystemTables.Views);

function renumbered(migrationId: string): RenumberedMigrationRow {
  return {
    source: {
      row: { versionId: `${migrationId}-version`, id: migrationId } as Row,
      migration: { id: migrationId } as Migration,
    },
    row: renumberedRow,
  };
}

function systemTablePlanOf(tableId: SystemTables): SystemTablePlan {
  return {
    tableId,
    versionIds: { head: `${tableId}-head`, draft: `${tableId}-draft` },
    outcome: 'mixed',
    linkSide: 'head',
    versionId: `${tableId}-head`,
    editInPlace: false,
    relinkCandidate: false,
    removedRowVersionIds: [],
    addedRowVersionIds: [],
    newRows: [],
  };
}

interface WritableTargetParts {
  readonly pairs?: readonly TablePair[];
  readonly tables?: readonly TablePlan[];
  readonly systemTables?: readonly SystemTablePlan[];
  readonly renumbered?: readonly RenumberedMigrationRow[];
}

function writableTargetOf({
  pairs = [],
  tables = [],
  systemTables = [],
  renumbered = [],
}: WritableTargetParts): WritableTarget {
  return {
    source: {
      snapshot: {
        branchId: BRANCH,
        headRevisionId: HEAD_REVISION,
        draftRevisionId: DRAFT_REVISION,
        tables: pairs,
      },
    },
    assembled: { tables, systemTables, ledger: { renumbered } },
  };
}

function tablePairOf(
  tableId: string,
  schemas: Partial<Record<RevisionSide, JsonSchema>>,
): TablePair {
  const identity = `${tableId}-identity`;

  return {
    identity,
    head: tableVersionOf(identity, tableId, 'head', schemas.head),
    draft: tableVersionOf(identity, tableId, 'draft', schemas.draft),
  };
}

function tableVersionOf(
  identity: string,
  tableId: string,
  side: RevisionSide,
  schema: JsonSchema | undefined,
): TableVersion | undefined {
  if (!schema) {
    return undefined;
  }

  return {
    versionId: `${tableId}-${side}`,
    createdId: identity,
    id: tableId,
    readonly: side === 'head',
    schema,
    history: [],
  };
}

function tablePlanOf(pair: TablePair, plan: Partial<TablePlan>): TablePlan {
  return {
    identity: pair.identity,
    outcome: 'unchanged',
    structureSide: 'draft',
    editInPlace: false,
    relinkCandidate: false,
    rows: [],
    removedRowVersionIds: [],
    addedRowVersionIds: [],
    newRows: [],
    ...plan,
  };
}
