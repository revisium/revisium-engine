import { readFileSync } from 'fs';
import * as ts from 'typescript';
import { compareCodePoints } from 'src/features/share/utils/compare-code-points';

export interface ReExportedNames {
  readonly types: readonly string[];
  readonly values: readonly string[];
}

interface ReExportedName {
  readonly name: string;
  readonly typeOnly: boolean;
}

const ALL_NAMES = '*';

export function namesReExportedFrom(
  entryPath: string,
  modulePrefix: string,
): ReExportedNames {
  const entry = ts.createSourceFile(
    entryPath,
    readFileSync(entryPath, 'utf8'),
    ts.ScriptTarget.Latest,
  );
  const names = entry.statements
    .filter(ts.isExportDeclaration)
    .filter((declaration) =>
      moduleSpecifierOf(declaration).startsWith(modulePrefix),
    )
    .flatMap(reExportedNamesOf);

  return {
    types: sortedNamesOf(names.filter(({ typeOnly }) => typeOnly)),
    values: sortedNamesOf(names.filter(({ typeOnly }) => !typeOnly)),
  };
}

function moduleSpecifierOf(declaration: ts.ExportDeclaration): string {
  const specifier = declaration.moduleSpecifier;

  if (!specifier || !ts.isStringLiteral(specifier)) {
    return '';
  }

  return specifier.text;
}

function reExportedNamesOf(
  declaration: ts.ExportDeclaration,
): ReExportedName[] {
  const clause = declaration.exportClause;

  if (!clause || !ts.isNamedExports(clause)) {
    return [{ name: ALL_NAMES, typeOnly: declaration.isTypeOnly }];
  }

  return clause.elements.map((element) => ({
    name: element.name.text,
    typeOnly: declaration.isTypeOnly || element.isTypeOnly,
  }));
}

function sortedNamesOf(names: readonly ReExportedName[]): string[] {
  return names.map(({ name }) => name).sort(compareCodePoints);
}
