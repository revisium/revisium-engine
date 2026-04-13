import type { InputJsonValue, Row } from 'src/engine-prisma-types';
import {
  JsonSchemaStore,
  JsonValueStore,
} from '@revisium/schema-toolkit/model';
import { JsonSchema } from '@revisium/schema-toolkit/types';

export interface FormulaFieldError {
  field: string;
  expression: string;
  error: string;
  defaultUsed: boolean;
}

export type ComputeRowsResult = {
  formulaErrors?: Map<string, FormulaFieldError[]>;
};

export type AfterCreateRowOptions = {
  revisionId: string;
  tableId: string;
  rowId: string;
  data: InputJsonValue;
  isRestore?: boolean;
};

export type AfterUpdateRowOptions = {
  revisionId: string;
  tableId: string;
  rowId: string;
  data: InputJsonValue;
  isRestore?: boolean;
};

export type ComputeRowsOptions = {
  revisionId: string;
  tableId: string;
  rows: Row[];
};

export type RowWithTableId = {
  tableId: string;
  row: Row;
};

export type AfterMigrateRowsOptions = {
  revisionId: string;
  tableId: string;
  rows: Row[];
  targetSchema?: JsonSchema;
};

export type InternalAfterCreateRowOptions = AfterCreateRowOptions & {
  schemaStore: JsonSchemaStore;
  valueStore: JsonValueStore;
};

export type InternalAfterUpdateRowOptions = AfterCreateRowOptions & {
  schemaStore: JsonSchemaStore;
  previousValueStore: JsonValueStore;
  valueStore: JsonValueStore;
};

export type InternalComputeRowsOptions = ComputeRowsOptions & {
  schemaStore: JsonSchemaStore;
};

export type InternalAfterMigrateRowsOptions = AfterMigrateRowsOptions & {
  schemaStore: JsonSchemaStore;
};

export interface IPluginService {
  isAvailable: boolean;
  afterCreateRow(options: InternalAfterCreateRowOptions): Promise<void> | void;
  afterUpdateRow(options: InternalAfterUpdateRowOptions): Promise<void> | void;
  computeRows(
    options: InternalComputeRowsOptions,
  ): Promise<ComputeRowsResult | void> | ComputeRowsResult | void;
  afterMigrateRows(
    options: InternalAfterMigrateRowsOptions,
  ): Promise<void> | void;
}
