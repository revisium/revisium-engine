import { SystemSchemaIds } from '@revisium/schema-toolkit/consts';
import { arr, obj, ref, str } from '@revisium/schema-toolkit/mocks';
import type { JsonSchema } from '@revisium/schema-toolkit/types';
import type {
  TableWriteOutcome,
  TableWritePlan,
} from 'src/features/draft-revision/commands/impl';
import type {
  RevisionSide,
  TableOutcome,
} from 'src/features/partial-changes/assembly/outcome-rules';
import type { MergedRow } from 'src/features/partial-changes/assembly/row-merger';
import type { SystemTablePlan } from 'src/features/partial-changes/assembly/system-target-assembler';
import type { TablePlan } from 'src/features/partial-changes/assembly/target-assembler';
import type {
  TablePair,
  TableVersion,
} from 'src/features/partial-changes/snapshot/changes-snapshot';
import { SystemTables } from 'src/features/share/system-tables.consts';
import {
  targetWritePlanOf,
  type WritableTarget,
} from '../target-write-plan-mapping';

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
    it('writes a table with the versions of both sides, its structure side, its link changes and whether it is a relink candidate', () => {
      const plan = targetWritePlanOf(
        writableTargetOf({
          pairs: [products],
          tables: [
            tablePlanOf(products, {
              outcome: 'mixed',
              structureSide: 'draft',
              relinkCandidate: true,
              removedLinks: ['p1-draft', 'p2-draft'],
              addedLinks: ['p1-head'],
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
          outcome: 'mixed',
          structureSide: 'draft',
          removedRowVersionIds: ['p1-draft', 'p2-draft'],
          addedRowVersionIds: ['p1-head'],
          newRows: [mergedP2],
          relinkCandidate: true,
          hasFileFields: false,
        },
      ]);
    });

    it.each<{ assembled: TableOutcome; written: TableWriteOutcome }>([
      { assembled: 'unchanged', written: 'unchanged' },
      { assembled: 'base', written: 'base' },
      { assembled: 'other', written: 'other' },
      { assembled: 'mixed', written: 'mixed' },
      { assembled: 'absent', written: 'absent' },
      { assembled: 'present', written: 'base' },
    ])(
      'writes a table assembled as $assembled with the outcome $written',
      ({ assembled, written }) => {
        const plan = targetWritePlanOf(
          writableTargetOf({
            pairs: [products],
            tables: [tablePlanOf(products, { outcome: assembled })],
          }),
        );

        expect(plan.tables).toMatchObject([{ outcome: written }]);
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
          outcome: 'absent',
          structureSide: 'head',
          hasFileFields: false,
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

        expect(plan.tables).toMatchObject([{ hasFileFields }]);
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

        expect(plan.tables).toMatchObject([{ hasFileFields }]);
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
              relinkCandidate: false,
              removedLinks: ['products-views-draft'],
              addedLinks: ['products-views-head'],
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
          outcome: 'mixed',
          structureSide: 'draft',
          removedRowVersionIds: ['products-views-draft'],
          addedRowVersionIds: ['products-views-head'],
          newRows: [],
          relinkCandidate: false,
          hasFileFields: false,
        },
      ]);
    });
  });
});

interface WritableTargetParts {
  readonly pairs?: readonly TablePair[];
  readonly tables?: readonly TablePlan[];
  readonly systemTables?: readonly SystemTablePlan[];
}

function writableTargetOf({
  pairs = [],
  tables = [],
  systemTables = [],
}: WritableTargetParts): WritableTarget {
  return {
    source: {
      snapshot: {
        headRevisionId: HEAD_REVISION,
        draftRevisionId: DRAFT_REVISION,
        tables: pairs,
      },
    },
    target: { tables, systemTables },
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
    relinkCandidate: false,
    rows: [],
    removedLinks: [],
    addedLinks: [],
    newRows: [],
    ...plan,
  };
}
