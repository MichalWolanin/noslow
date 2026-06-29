import { PrivacyMode } from '../types';

const STRING_LITERAL = /'(?:[^'\\]|\\.)*'/g;
const NUMERIC_LITERAL = /(?<![.\w])\b\d+(?:\.\d+)?\b(?!\w)/g;
// Keywords that introduce table names
const TABLE_PATTERN = /\b(FROM|JOIN|INTO|UPDATE)\s+[`"]?([a-zA-Z_]\w*)[`"]?/gi;
// Identifiers before comparison operators
const COLUMN_PATTERN = /\b([a-zA-Z_]\w*)\s*(=|!=|<>|>=|<=|>|<|LIKE|ILIKE)\s*/gi;

export function sanitizeSql(sql: string, mode: PrivacyMode): string {
  let result = sql;

  // Replace string literals: 'value' -> ?
  result = result.replace(STRING_LITERAL, '?');

  // Replace numeric literals: 42 -> ?, 3.14 -> ?
  result = result.replace(NUMERIC_LITERAL, '?');

  if (mode === 'paranoid') {
    result = result.replace(TABLE_PATTERN, (_, keyword: string) => `${keyword.toUpperCase()} [table]`);
    result = result.replace(COLUMN_PATTERN, (_, _col: string, op: string) => `[col] ${op} `);
  }

  return result;
}
