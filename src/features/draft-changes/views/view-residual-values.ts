import { deepEqual } from '@revisium/schema-toolkit/lib';
import type { CandidateSchemaProjectionBinding } from 'src/features/draft-changes/queries/impl/calculate-data-candidates.query';
import {
  isRecord,
  mapFieldItem,
  mapFilterFields,
} from 'src/features/draft-changes/views/view-field-values';

const SOURCE_SKIP_COST = 2;

export interface ResidualValueResult {
  value: unknown;
  ambiguous: boolean;
}

export function mergeViewFieldArray(
  original: unknown,
  current: unknown,
  target: unknown,
  binding: CandidateSchemaProjectionBinding | undefined,
): ResidualValueResult {
  return mergeSequence(
    mapArray(original, (value) => mapFieldItem(value, binding)),
    mapArray(current, (value) => mapFieldItem(value, binding)),
    target,
    sameField,
    sameField,
    mergeFieldItem,
  );
}

export function mergeViewFilter(
  original: unknown,
  current: unknown,
  target: unknown,
  binding: CandidateSchemaProjectionBinding | undefined,
): ResidualValueResult {
  return mergeFilter(
    mapFilterFields(original, binding),
    mapFilterFields(current, binding),
    structuredClone(target),
  );
}

function mergeFilter(
  original: unknown,
  current: unknown,
  target: unknown,
): ResidualValueResult {
  if (deepEqual(original, current)) {
    return { value: structuredClone(target), ambiguous: false };
  }
  if (deepEqual(original, target)) {
    return { value: structuredClone(current), ambiguous: false };
  }
  if (!isRecord(original) || !isRecord(current) || !isRecord(target)) {
    return { value: structuredClone(current), ambiguous: false };
  }

  const output = structuredClone(target);
  const keys = new Set([...Object.keys(original), ...Object.keys(current)]);
  for (const key of keys) {
    const projection = mergeFilterProperty(key, original, current, target);
    if (projection.ambiguous) {
      return projection;
    }
    if (!projection.changed) {
      continue;
    }
    if (projection.remove) {
      delete output[key];
    } else {
      output[key] = projection.value;
    }
  }
  return { value: output, ambiguous: false };
}

function mergeFilterProperty(
  key: string,
  original: Record<string, unknown>,
  current: Record<string, unknown>,
  target: Record<string, unknown>,
): ResidualValueResult & { changed?: boolean; remove?: boolean } {
  const hadOriginal = Object.prototype.hasOwnProperty.call(original, key);
  const hasCurrent = Object.prototype.hasOwnProperty.call(current, key);
  if (hadOriginal === hasCurrent && deepEqual(original[key], current[key])) {
    return { value: target[key], ambiguous: false };
  }
  if (!hasCurrent) {
    return { value: undefined, ambiguous: false, changed: true, remove: true };
  }
  if (!hadOriginal) {
    return {
      value: structuredClone(current[key]),
      ambiguous: false,
      changed: true,
    };
  }
  const merged = isFilterSequence(key)
    ? mergeFilterSequence(key, original[key], current[key], target[key])
    : mergeFilter(original[key], current[key], target[key]);
  return { ...merged, changed: true };
}

function mergeFilterSequence(
  key: 'conditions' | 'groups',
  original: unknown,
  current: unknown,
  target: unknown,
): ResidualValueResult {
  if (key === 'conditions') {
    return mergeSequence(
      original,
      current,
      target,
      sameConditionEdit,
      sameCondition,
      mergeFieldItem,
    );
  }
  return mergeSequence(
    original,
    current,
    target,
    compatibleGroupEdit,
    compatibleGroup,
    mergeFilter,
  );
}

function isFilterSequence(key: string): key is 'conditions' | 'groups' {
  return key === 'conditions' || key === 'groups';
}

function mergeSequence(
  original: unknown,
  current: unknown,
  target: unknown,
  draftCompatible: (left: unknown, right: unknown) => boolean,
  targetCompatible: (left: unknown, right: unknown) => boolean,
  merge: (
    original: unknown,
    current: unknown,
    target: unknown,
  ) => ResidualValueResult,
): ResidualValueResult {
  if (deepEqual(original, current)) {
    return { value: structuredClone(target), ambiguous: false };
  }
  if (
    !Array.isArray(original) ||
    !Array.isArray(current) ||
    !Array.isArray(target)
  ) {
    return { value: structuredClone(current), ambiguous: false };
  }
  if (deepEqual(original, target)) {
    return { value: structuredClone(current), ambiguous: false };
  }

  const sourceToCurrent = uniqueOrConvergentAlignments(
    original,
    current,
    target,
    draftCompatible,
    targetCompatible,
  );
  if (!sourceToCurrent) {
    return { value: structuredClone(target), ambiguous: true };
  }
  // B is already expressed in the target role's final field coordinates.
  // Reverse the alignment direction to return source-index -> target-index.
  const sourceToTarget = possibleAlignments(
    target,
    original,
    targetCompatible,
    0,
    SOURCE_SKIP_COST,
  );
  const edits = collectExistingChanges(
    original,
    current,
    target,
    sourceToCurrent,
    sourceToTarget,
    merge,
  );
  if (!edits) {
    return { value: structuredClone(target), ambiguous: true };
  }
  const insertions = collectInsertions(
    current,
    sourceToCurrent,
    sourceToTarget,
    original.length,
    target.length,
  );
  if (!insertions) {
    return { value: structuredClone(target), ambiguous: true };
  }
  return {
    value: applySequenceChanges(target, [...edits, ...insertions]),
    ambiguous: false,
  };
}

type SequenceChange = {
  index: number;
  value?: unknown;
  insert?: boolean;
  currentIndex?: number;
};

function collectExistingChanges(
  original: unknown[],
  current: unknown[],
  target: unknown[],
  sourceToCurrent: Map<number, number>,
  sourceToTarget: Map<number, Set<number>>,
  merge: (
    original: unknown,
    current: unknown,
    target: unknown,
  ) => ResidualValueResult,
): SequenceChange[] | undefined {
  const changes: SequenceChange[] = [];
  for (let sourceIndex = 0; sourceIndex < original.length; sourceIndex++) {
    const currentIndex = sourceToCurrent.get(sourceIndex);
    const targetIndexes = sourceToTarget.get(sourceIndex) ?? new Set<number>();
    const change = projectOccurrenceChange(
      sourceIndex,
      currentIndex,
      targetIndexes,
      original,
      current,
      target,
      merge,
    );
    if (change === null) {
      continue;
    }
    if (!change) {
      return undefined;
    }
    changes.push(change);
  }
  return changes;
}

function projectOccurrenceChange(
  sourceIndex: number,
  currentIndex: number | undefined,
  targetIndexes: Set<number>,
  original: unknown[],
  current: unknown[],
  target: unknown[],
  merge: (
    original: unknown,
    current: unknown,
    target: unknown,
  ) => ResidualValueResult,
): SequenceChange | null | undefined {
  const currentValue =
    currentIndex === undefined ? undefined : current[currentIndex];
  if (
    currentIndex !== undefined &&
    deepEqual(original[sourceIndex], currentValue)
  ) {
    return null;
  }
  if (targetIndexes.size > 1) {
    return undefined;
  }
  if (targetIndexes.size === 0) {
    return currentIndex === undefined ? null : undefined;
  }
  const targetIndex = uniqueIndex(targetIndexes);
  if (targetIndex === undefined) {
    return undefined;
  }
  if (currentIndex === undefined) {
    return { index: targetIndex };
  }
  const result = merge(
    original[sourceIndex],
    currentValue,
    target[targetIndex],
  );
  return result.ambiguous
    ? undefined
    : { index: targetIndex, value: result.value };
}

function collectInsertions(
  current: unknown[],
  sourceToCurrent: Map<number, number>,
  sourceToTarget: Map<number, Set<number>>,
  sourceCount: number,
  targetCount: number,
): SequenceChange[] | undefined {
  const matchedCurrent = new Set(sourceToCurrent.values());
  const additions: SequenceChange[] = [];
  for (let currentIndex = 0; currentIndex < current.length; currentIndex++) {
    if (matchedCurrent.has(currentIndex)) {
      continue;
    }
    const index = insertionIndex(
      currentIndex,
      sourceToCurrent,
      sourceToTarget,
      sourceCount,
      targetCount,
    );
    if (index === undefined) {
      return undefined;
    }
    additions.push({
      index,
      value: current[currentIndex],
      insert: true,
      currentIndex,
    });
  }
  return additions;
}

function applySequenceChanges(target: unknown[], changes: SequenceChange[]) {
  const output = structuredClone(target);
  const ordered = changes.sort(
    (left, right) =>
      right.index - left.index ||
      (right.currentIndex ?? -1) - (left.currentIndex ?? -1),
  );
  for (const change of ordered) {
    applySequenceChange(output, change);
  }
  return output;
}

function applySequenceChange(values: unknown[], change: SequenceChange) {
  if (change.insert) {
    values.splice(change.index, 0, change.value);
  } else if (change.value === undefined) {
    values.splice(change.index, 1);
  } else {
    values[change.index] = change.value;
  }
}

function insertionIndex(
  currentIndex: number,
  sourceToCurrent: Map<number, number>,
  sourceToTarget: Map<number, Set<number>>,
  sourceCount: number,
  targetCount: number,
): number | undefined {
  const mapped = [...sourceToCurrent.entries()].sort(
    (left, right) => left[1] - right[1],
  );
  const before = mapped
    .filter(([, index]) => index < currentIndex)
    .map(([source]) => source)
    .reverse();
  const after = mapped
    .filter(([, index]) => index > currentIndex)
    .map(([source]) => source);
  const left = before
    .map((source) => uniqueIndex(sourceToTarget.get(source)))
    .find((index) => index !== undefined);
  const right = after
    .map((source) => uniqueIndex(sourceToTarget.get(source)))
    .find((index) => index !== undefined);
  if (left !== undefined && right !== undefined) {
    return right === left + 1 ? right : undefined;
  }
  if (right !== undefined) {
    return right === 0 ? 0 : undefined;
  }
  if (left !== undefined) {
    return left === targetCount - 1 ? targetCount : undefined;
  }
  return sourceCount === 0 && targetCount === 0 ? 0 : undefined;
}

function uniqueIndex(indexes: Set<number> | undefined): number | undefined {
  return indexes?.size === 1 ? [...indexes][0] : undefined;
}

function uniqueOrConvergentAlignments(
  original: unknown[],
  current: unknown[],
  target: unknown[],
  draftCompatible: (left: unknown, right: unknown) => boolean,
  targetCompatible: (left: unknown, right: unknown) => boolean,
): Map<number, number> | undefined {
  const currentCandidates = possibleAlignments(
    original,
    current,
    draftCompatible,
    1,
    1,
  );
  const targetCandidates = possibleAlignments(
    target,
    original,
    targetCompatible,
    0,
    SOURCE_SKIP_COST,
  );
  const sourceCandidates = reverseEdges(currentCandidates);
  const result = new Map<number, number>();
  const convergentRuns: Array<{ current: number; sources: number[] }> = [];
  for (const [currentIndex, sources] of currentCandidates) {
    if (sources.size === 1) {
      const sourceIndex = uniqueIndex(sources);
      if (
        sourceIndex === undefined ||
        sourceCandidates.get(sourceIndex)?.size !== 1
      ) {
        return undefined;
      }
      result.set(sourceIndex, currentIndex);
      continue;
    }
    const indexes = [...sources].sort((left, right) => left - right);
    if (!isContiguous(indexes)) {
      return undefined;
    }
    convergentRuns.push({ current: currentIndex, sources: indexes });
  }
  for (const run of convergentRuns) {
    if (
      !isConvergentRun(
        run,
        original,
        target,
        sourceCandidates,
        targetCandidates,
      )
    ) {
      return undefined;
    }
    const representative = run.sources[0];
    if (representative === undefined) {
      return undefined;
    }
    result.set(representative, run.current);
  }
  return result;
}

function isConvergentRun(
  run: { current: number; sources: number[] },
  original: unknown[],
  target: unknown[],
  sourceCandidates: Map<number, Set<number>>,
  targetCandidates: Map<number, Set<number>>,
): boolean {
  const firstSource = run.sources[0];
  const firstTarget =
    firstSource === undefined
      ? undefined
      : uniqueIndex(targetCandidates.get(firstSource));
  if (firstSource === undefined || firstTarget === undefined) {
    return false;
  }
  for (const [offset, sourceIndex] of run.sources.entries()) {
    if (
      !sameSingleton(sourceCandidates.get(sourceIndex), run.current) ||
      !deepEqual(original[sourceIndex], original[firstSource])
    ) {
      return false;
    }
    const targetIndex = uniqueIndex(targetCandidates.get(sourceIndex));
    if (
      targetIndex !== firstTarget + offset ||
      !deepEqual(target[targetIndex], target[firstTarget])
    ) {
      return false;
    }
  }
  return true;
}

function reverseEdges(
  edges: Map<number, Set<number>>,
): Map<number, Set<number>> {
  const reversed = new Map<number, Set<number>>();
  for (const [target, sources] of edges) {
    for (const source of sources) {
      const targets = reversed.get(source) ?? new Set<number>();
      targets.add(target);
      reversed.set(source, targets);
    }
  }
  return reversed;
}

function isContiguous(indexes: number[]): boolean {
  const first = indexes[0];
  return (
    first !== undefined &&
    indexes.every((index, offset) => index === first + offset)
  );
}

function sameSingleton(
  indexes: Set<number> | undefined,
  expected: number,
): boolean {
  return indexes?.size === 1 && indexes.has(expected);
}

function possibleAlignments(
  original: unknown[],
  current: unknown[],
  compatible: (left: unknown, right: unknown) => boolean,
  skipOriginalCost: number,
  skipCurrentCost: number,
): Map<number, Set<number>> {
  const forward = alignmentCosts(
    original,
    current,
    compatible,
    skipOriginalCost,
    skipCurrentCost,
  );
  const backward = alignmentCosts(
    [...original].reverse(),
    [...current].reverse(),
    compatible,
    skipOriginalCost,
    skipCurrentCost,
  );
  const best = matrixValue(forward, original.length, current.length);
  const result = new Map<number, Set<number>>();
  for (let i = 0; i < original.length; i++) {
    for (let j = 0; j < current.length; j++) {
      if (!compatible(original[i], current[j])) {
        continue;
      }
      const cost = deepEqual(original[i], current[j]) ? 0 : 1;
      const suffix = matrixValue(
        backward,
        original.length - i - 1,
        current.length - j - 1,
      );
      if (matrixValue(forward, i, j) + cost + suffix === best) {
        const indexes = result.get(j) ?? new Set<number>();
        indexes.add(i);
        result.set(j, indexes);
      }
    }
  }
  return result;
}

function alignmentCosts(
  original: unknown[],
  current: unknown[],
  compatible: (left: unknown, right: unknown) => boolean,
  skipOriginalCost: number,
  skipCurrentCost: number,
): number[][] {
  const costs = Array.from({ length: original.length + 1 }, () =>
    Array<number>(current.length + 1).fill(Number.POSITIVE_INFINITY),
  );
  setMatrixValue(costs, 0, 0, 0);
  for (let i = 0; i <= original.length; i++) {
    for (let j = 0; j <= current.length; j++) {
      relaxAlignmentCell(
        costs,
        original,
        current,
        compatible,
        i,
        j,
        skipOriginalCost,
        skipCurrentCost,
      );
    }
  }
  return costs;
}

function relaxAlignmentCell(
  costs: number[][],
  original: unknown[],
  current: unknown[],
  compatible: (left: unknown, right: unknown) => boolean,
  i: number,
  j: number,
  skipOriginalCost: number,
  skipCurrentCost: number,
): void {
  const currentCost = matrixValue(costs, i, j);
  if (i < original.length) {
    relaxCost(costs, i + 1, j, currentCost + skipOriginalCost);
  }
  if (j < current.length) {
    relaxCost(costs, i, j + 1, currentCost + skipCurrentCost);
  }
  if (canMatchAt(original, current, compatible, i, j)) {
    const matchCost = deepEqual(original[i], current[j]) ? 0 : 1;
    relaxCost(costs, i + 1, j + 1, currentCost + matchCost);
  }
}

function canMatchAt(
  original: unknown[],
  current: unknown[],
  compatible: (left: unknown, right: unknown) => boolean,
  i: number,
  j: number,
): boolean {
  return (
    i < original.length &&
    j < current.length &&
    compatible(original[i], current[j])
  );
}

function relaxCost(
  costs: number[][],
  row: number,
  column: number,
  candidate: number,
): void {
  setMatrixValue(
    costs,
    row,
    column,
    Math.min(matrixValue(costs, row, column), candidate),
  );
}

function matrixValue(matrix: number[][], row: number, column: number): number {
  return matrix[row]?.[column] ?? Number.POSITIVE_INFINITY;
}

function setMatrixValue(
  matrix: number[][],
  row: number,
  column: number,
  value: number,
): void {
  const line = matrix[row];
  if (line) {
    line[column] = value;
  }
}

function mergeFieldItem(
  original: unknown,
  current: unknown,
  target: unknown,
): ResidualValueResult {
  if (!isRecord(original) || !isRecord(current) || !isRecord(target)) {
    return { value: structuredClone(current), ambiguous: false };
  }
  const output = structuredClone(target);
  for (const key of new Set([
    ...Object.keys(original),
    ...Object.keys(current),
  ])) {
    const hadOriginal = Object.prototype.hasOwnProperty.call(original, key);
    const hasCurrent = Object.prototype.hasOwnProperty.call(current, key);
    if (hadOriginal === hasCurrent && deepEqual(original[key], current[key])) {
      continue;
    }
    if (!hasCurrent) {
      delete output[key];
    } else {
      output[key] = structuredClone(current[key]);
    }
  }
  return { value: output, ambiguous: false };
}

function sameCondition(left: unknown, right: unknown): boolean {
  const identity = conditionIdentity(left);
  return identity !== undefined && identity === conditionIdentity(right);
}

function sameConditionEdit(left: unknown, right: unknown): boolean {
  const leftField = fieldOf(left);
  return leftField !== undefined && leftField === fieldOf(right);
}

function sameField(left: unknown, right: unknown): boolean {
  const identity = fieldOf(left);
  return identity !== undefined && identity === fieldOf(right);
}

function compatibleGroup(left: unknown, right: unknown): boolean {
  return groupsShareStructure(left, right, true);
}

function compatibleGroupEdit(left: unknown, right: unknown): boolean {
  return groupsShareStructure(left, right, false);
}

function groupsShareStructure(
  left: unknown,
  right: unknown,
  preserveLogic: boolean,
): boolean {
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }
  if (preserveLogic && left.logic !== right.logic) {
    return false;
  }
  const rightConditions = new Set(
    directConditionIdentities(right, preserveLogic),
  );
  if (
    directConditionIdentities(left, preserveLogic).some((identity) =>
      rightConditions.has(identity),
    )
  ) {
    return true;
  }
  const leftGroups = childGroups(left);
  const rightGroups = childGroups(right);
  return leftGroups.some((leftGroup) =>
    rightGroups.some((rightGroup) =>
      groupsShareStructure(leftGroup, rightGroup, preserveLogic),
    ),
  );
}

function directConditionIdentities(
  group: Record<string, unknown>,
  includeOperator: boolean,
): string[] {
  return Array.isArray(group.conditions)
    ? group.conditions
        .map((condition) =>
          includeOperator ? conditionIdentity(condition) : fieldOf(condition),
        )
        .filter((identity): identity is string => identity !== undefined)
    : [];
}

function childGroups(
  group: Record<string, unknown>,
): Record<string, unknown>[] {
  return Array.isArray(group.groups) ? group.groups.filter(isRecord) : [];
}

function conditionIdentity(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.field !== 'string') {
    return undefined;
  }
  return JSON.stringify([value.field, value.operator]);
}

function fieldOf(value: unknown): string | undefined {
  return isRecord(value) && typeof value.field === 'string'
    ? value.field
    : undefined;
}

function mapArray(value: unknown, map: (value: unknown) => unknown): unknown {
  return Array.isArray(value) ? value.map(map) : value;
}
