import { TableViewsData } from 'src/features/views/types';

export class UpdateTableViewsCommand {
  constructor(
    public readonly data: {
      revisionId: string;
      tableId: string;
      viewsData: TableViewsData;
    },
  ) {}
}
