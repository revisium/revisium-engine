export interface DraftChangesPage {
  first?: number;
  after?: string;
}

export interface DraftChangesConnection<T> {
  totalCount: number;
  edges: Array<{ cursor: string; node: T }>;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}
