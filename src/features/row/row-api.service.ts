import { Injectable } from '@nestjs/common';
import { InternalRowApiService } from 'src/features/row/internal-row-api.service';
import {
  GetRowByIdQueryData,
  GetRowQueryData,
  GetRowsQueryData,
  ResolveRowCountForeignKeysByQueryData,
  ResolveRowCountForeignKeysToQueryData,
  ResolveRowForeignKeysByQueryData,
  ResolveRowForeignKeysToQueryData,
  SearchRowsQueryData,
} from 'src/features/row/queries/impl';

@Injectable()
export class RowApiService {
  constructor(private readonly api: InternalRowApiService) {}

  public getRow(data: GetRowQueryData) {
    return this.api.getRow(data);
  }

  public getRowById(data: GetRowByIdQueryData) {
    return this.api.getRowById(data);
  }

  public getRows(data: GetRowsQueryData) {
    return this.api.getRows(data);
  }

  public resolveRowCountForeignKeysBy(
    data: ResolveRowCountForeignKeysByQueryData,
  ) {
    return this.api.resolveRowCountForeignKeysBy(data);
  }

  public resolveRowCountForeignKeysTo(
    data: ResolveRowCountForeignKeysToQueryData,
  ) {
    return this.api.resolveRowCountForeignKeysTo(data);
  }

  public resolveRowForeignKeysBy(data: ResolveRowForeignKeysByQueryData) {
    return this.api.resolveRowForeignKeysBy(data);
  }

  public resolveRowForeignKeysTo(data: ResolveRowForeignKeysToQueryData) {
    return this.api.resolveRowForeignKeysTo(data);
  }

  public searchRows(data: SearchRowsQueryData) {
    return this.api.searchRows(data);
  }
}
