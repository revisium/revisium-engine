import { SystemTables } from 'src/features/share/system-tables.consts';

export function migrationTableOf(revisionId: string) {
  return {
    some: {
      id: SystemTables.Migration,
      revisions: {
        some: {
          id: revisionId,
        },
      },
    },
  };
}
