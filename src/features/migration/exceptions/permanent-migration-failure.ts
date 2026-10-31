export class PermanentMigrationFailure extends Error {
  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = PermanentMigrationFailure.name;
  }
}
