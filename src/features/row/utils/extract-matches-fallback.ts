import type { JsonValue } from 'src/engine-prisma-types';
import { SearchMatch } from 'src/features/row/queries/impl';

const MAX_MATCHES = 5;
const EXACT_MATCH_BASE = 100;
const STARTS_WITH_BASE = 50;
const CONTAINS_BASE = 10;
const LENGTH_BONUS_MAX = 20;
const PRIMITIVE_RELEVANCE = 30;

interface MatchWithRelevance {
  match: SearchMatch;
  relevance: number;
}

export function extractMatchesFallback(
  data: JsonValue,
  query: string,
): SearchMatch[] {
  const matches: MatchWithRelevance[] = [];

  const queryTokens = query
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter((t) => t.length > 0);

  searchInObject(data, '', queryTokens, matches);

  matches.sort((a, b) => b.relevance - a.relevance);
  return matches.slice(0, MAX_MATCHES).map((item) => item.match);
}

function searchInObject(
  obj: JsonValue,
  path: string,
  queryTokens: string[],
  matches: MatchWithRelevance[],
): void {
  if (obj === null) {
    return;
  }

  if (typeof obj === 'string') {
    handleStringMatch(obj, path, queryTokens, matches);
  } else if (typeof obj === 'number' || typeof obj === 'boolean') {
    handlePrimitiveMatch(obj, path, queryTokens, matches);
  } else if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      searchInObject(
        item,
        path ? `${path}[${index}]` : `[${index}]`,
        queryTokens,
        matches,
      );
    });
  } else if (typeof obj === 'object') {
    Object.entries(obj).forEach(([key, value]) => {
      searchInObject(
        value as JsonValue,
        path ? `${path}.${key}` : key,
        queryTokens,
        matches,
      );
    });
  }
}

function handleStringMatch(
  value: string,
  path: string,
  queryTokens: string[],
  matches: MatchWithRelevance[],
): void {
  const lowerValue = value.toLowerCase();
  const valueTokens = lowerValue.split(/[\s_-]+/).filter((t) => t.length > 0);

  const hasMatch = queryTokens.some((queryToken) =>
    valueTokens.some((valueToken) => valueToken.includes(queryToken)),
  );

  if (!hasMatch) {
    return;
  }

  const relevance = calculateRelevance(value, queryTokens, valueTokens);
  matches.push({
    match: {
      path: path || 'data',
      value,
      highlight: highlightText(value, queryTokens),
    },
    relevance,
  });
}

function calculateRelevance(
  value: string,
  queryTokens: string[],
  valueTokens: string[],
): number {
  const exactMatch = queryTokens.every((queryToken) =>
    valueTokens.includes(queryToken),
  );
  if (exactMatch) {
    return EXACT_MATCH_BASE + Math.max(0, LENGTH_BONUS_MAX - value.length);
  }

  const startsWithMatch = queryTokens.some((queryToken) =>
    valueTokens.some((valueToken) => valueToken.startsWith(queryToken)),
  );
  if (startsWithMatch) {
    return STARTS_WITH_BASE + Math.max(0, LENGTH_BONUS_MAX - value.length);
  }

  return CONTAINS_BASE + Math.max(0, LENGTH_BONUS_MAX - value.length);
}

function handlePrimitiveMatch(
  value: number | boolean,
  path: string,
  queryTokens: string[],
  matches: MatchWithRelevance[],
): void {
  const stringValue = String(value);
  const lowerValue = stringValue.toLowerCase();

  if (queryTokens.some((token) => lowerValue.includes(token))) {
    matches.push({
      match: {
        path: path || 'data',
        value: stringValue,
        highlight: highlightText(stringValue, queryTokens),
      },
      relevance: PRIMITIVE_RELEVANCE,
    });
  }
}

function escapeRegExp(string: string): string {
  return string.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function highlightText(text: string, terms: string[]): string {
  let highlighted = text;
  terms.forEach((term) => {
    const escapedTerm = escapeRegExp(term);
    const regex = new RegExp(`(${escapedTerm})`, 'gi');
    highlighted = highlighted.replace(regex, '<mark>$1</mark>');
  });
  return highlighted;
}
