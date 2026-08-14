import type { JsonValue } from 'src/engine-prisma-types';
import type {
  GetPreviousRowStatesQueryData,
  GetPreviousRowStatesQueryReturnType,
} from 'src/features/row/queries/impl';

const DEFAULT_PAGE_SIZE = 10;

/** Symbolic branches and revisions used by feature-level acceptance tests. */
export type PreviousRowStatesDefinition = {
  readonly branches?: Readonly<
    Record<string, { readonly root?: boolean; readonly project?: string }>
  >;
  readonly revisions: readonly PreviousRowStatesRevisionDefinition[];
};

export type PreviousRowStatesRevisionDefinition = {
  readonly as: string;
  readonly branch?: string;
  readonly parent?: string | null;
  readonly start?: boolean;
  readonly draft?: boolean;
  readonly table?: {
    readonly identity?: string;
    readonly id?: string;
  };
  readonly row: {
    readonly identity?: string;
    readonly id?: string;
    readonly data: JsonValue;
  } | null;
};

type PreviousRowStateOptions = Omit<
  PreviousRowStatesRevisionDefinition,
  'as' | 'row'
> & {
  readonly identity?: string;
  readonly rowId?: string;
  readonly tableId?: string;
};

/** Concise data-object form for a revision containing the logical row. */
export function rowState(
  as: string,
  value: string,
  { identity, rowId, tableId, ...revision }: PreviousRowStateOptions = {},
): PreviousRowStatesRevisionDefinition {
  return {
    ...revision,
    as,
    ...(tableId ? { table: { ...revision.table, id: tableId } } : {}),
    row: {
      ...(identity ? { identity } : {}),
      ...(rowId ? { id: rowId } : {}),
      data: { value },
    },
  };
}

/** Concise data-object form for a revision before the logical row exists. */
export function tableState(
  as: string,
  revision: Omit<PreviousRowStatesRevisionDefinition, 'as' | 'row'> = {},
): PreviousRowStatesRevisionDefinition {
  return { ...revision, as, row: null };
}

export type PersistedPreviousRowStatesRevision = {
  readonly revisionId: string;
  readonly branch: string;
  readonly branchId: string;
  readonly tableId: string;
  readonly tableCreatedId: string;
  readonly tableVersionId: string;
  readonly rowId: string | null;
  readonly rowCreatedId: string | null;
  readonly rowVersionId: string | null;
};

export type ProjectedPreviousRowState = {
  readonly revision: string;
  readonly branch: string;
  readonly row: {
    readonly id: string;
    readonly data: JsonValue;
  };
  readonly introducedBy: readonly string[];
};

export class PreviousRowStatesScenario {
  private readonly revisionAliasesById = new Map<string, string>();
  private readonly branchAliasesById = new Map<string, string>();

  constructor(
    readonly revisions: ReadonlyMap<string, PersistedPreviousRowStatesRevision>,
    readonly branches: ReadonlyMap<string, string>,
    private readonly execute: (
      data: GetPreviousRowStatesQueryData,
    ) => Promise<GetPreviousRowStatesQueryReturnType>,
  ) {
    for (const [alias, revision] of revisions) {
      this.revisionAliasesById.set(revision.revisionId, alias);
    }
    for (const [alias, branchId] of branches) {
      this.branchAliasesById.set(branchId, alias);
    }
  }

  at(
    revisionAlias: string,
    options: {
      readonly first?: number;
      readonly after?: string;
      readonly tableId?: string;
      readonly rowId?: string;
    } = {},
  ): Promise<GetPreviousRowStatesQueryReturnType> {
    return this.execute(this.inputAt(revisionAlias, options));
  }

  inputAt(
    revisionAlias: string,
    options: {
      readonly first?: number;
      readonly after?: string;
      readonly tableId?: string;
      readonly rowId?: string;
    } = {},
  ): GetPreviousRowStatesQueryData {
    const revision = this.revision(revisionAlias);
    const rowId = options.rowId ?? revision.rowId;
    if (!rowId) {
      throw new Error(
        `Revision "${revisionAlias}" has no row; provide rowId explicitly`,
      );
    }

    return {
      revisionId: revision.revisionId,
      tableId: options.tableId ?? revision.tableId,
      rowId,
      first: options.first ?? DEFAULT_PAGE_SIZE,
      ...(options.after !== undefined ? { after: options.after } : {}),
    };
  }

  project(
    result: GetPreviousRowStatesQueryReturnType,
  ): readonly ProjectedPreviousRowState[] | undefined {
    return result?.edges.map(({ node }) => ({
      revision: this.aliasForRevision(node.revision.id),
      branch: this.aliasForBranch(node.branch.id),
      row: { id: node.row.id, data: node.row.data },
      introducedBy: node.introducedBy,
    }));
  }

  revision(alias: string): PersistedPreviousRowStatesRevision {
    const revision = this.revisions.get(alias);
    if (!revision) {
      throw new Error(`Unknown revision alias "${alias}"`);
    }
    return revision;
  }

  revisionId(alias: string): string {
    return this.revision(alias).revisionId;
  }

  branchId(alias: string): string {
    const branchId = this.branches.get(alias);
    if (!branchId) {
      throw new Error(`Unknown branch alias "${alias}"`);
    }
    return branchId;
  }

  rowVersionId(alias: string): string {
    const rowVersionId = this.revision(alias).rowVersionId;
    if (!rowVersionId) {
      throw new Error(`Revision "${alias}" has no row version`);
    }
    return rowVersionId;
  }

  private aliasForRevision(revisionId: string): string {
    return this.revisionAliasesById.get(revisionId) ?? revisionId;
  }

  private aliasForBranch(branchId: string): string {
    return this.branchAliasesById.get(branchId) ?? branchId;
  }
}
