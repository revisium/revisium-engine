import type { JsonValue } from '@revisium/schema-toolkit/types';
import type { FieldChange } from 'src/features/revision-changes/types';

export interface SuppliedRowPair {
  key: string;
  fromData: JsonValue;
  toData: JsonValue;
}

export interface CompareSuppliedRowsQueryData {
  pairs: SuppliedRowPair[];
}

export interface ComparedSuppliedRow {
  key: string;
  fieldChanges: FieldChange[];
}

export interface CompareSuppliedRowsQueryResult {
  pairs: ComparedSuppliedRow[];
}

export class CompareSuppliedRowsQuery {
  constructor(public readonly data: CompareSuppliedRowsQueryData) {}
}
