import type { Table } from 'src/engine-prisma-types';

export type TableWithContext = Table & {
  context: { revisionId?: string };
};
