import type { DraftChangeRef } from 'src/features/draft-changes/queries/impl/build-draft-changes-catalogue.query';

export interface DraftChangeLeaf {
  ref: DraftChangeRef;
  kind: 'created' | 'deleted' | 'renamed' | 'updated' | 'computed' | 'atomic';
  label: string;
  selectable: boolean;
  effect?: {
    target?: 'head' | 'draft';
    tableId: string;
    rowId?: string;
    path?: string;
    change: string;
    before: unknown;
    after: unknown;
    beforeExists?: boolean;
    afterExists?: boolean;
  };
}
