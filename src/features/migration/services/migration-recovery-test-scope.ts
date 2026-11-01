export const MIGRATION_RECOVERY_TEST_SCOPE = Symbol(
  'MIGRATION_RECOVERY_TEST_SCOPE',
);

/**
 * Test isolation, absent in production: there the sweep and the legacy disposal act on every migration record. Test
 * kits share one database, so they provide this scope to act only on the records a test names.
 */
export interface MigrationRecoveryTestScope {
  restrictedTo(): readonly string[];
}
