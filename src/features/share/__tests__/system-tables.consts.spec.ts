import {
  findSchemaForSystemTables,
  systemTablesIds,
  SystemTables,
} from 'src/features/share/system-tables.consts';

describe('system-tables.consts', () => {
  describe('findSchemaForSystemTables', () => {
    it.each(systemTablesIds)(
      'should return a schema for system table "%s"',
      (tableId) => {
        const schema = findSchemaForSystemTables(tableId);
        expect(schema).toBeDefined();
      },
    );

    it('should return undefined for non-system table', () => {
      const schema = findSchemaForSystemTables('non-existent-table');
      expect(schema).toBeUndefined();
    });
  });

  it('should include SharedSchemas in systemTablesIds', () => {
    expect(systemTablesIds).toContain(SystemTables.SharedSchemas);
  });

  it('should have a schema mapping for SharedSchemas', () => {
    const schema = findSchemaForSystemTables(SystemTables.SharedSchemas);
    expect(schema).toBeDefined();
  });
});
