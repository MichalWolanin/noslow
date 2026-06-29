import { QueryEvent, AnalyzerResult, Config } from '../types';

const N1_THRESHOLD = 5;
const N1_WINDOW_MS = 1000;
const MAX_TRACKED_QUERIES = 5000;

interface QueryRecord {
  count: number;
  firstSeenMs: number;
}

function isFullTableScan(sql: string): boolean {
  const upper = sql.toUpperCase().trim();
  return upper.startsWith('SELECT') && upper.includes('FROM') && !upper.includes('WHERE');
}

// Safe WHERE extraction using linear string ops — avoids ReDoS from (.+?) + alternation.
// The old regex WHERE\s+(.+?)(?:\s+ORDER\s+BY|...|$) is O(n²) for SQL with many
// partial keyword matches (e.g. repeated "ORDER" without "BY").
function extractWherePart(sql: string): string {
  const m = /\bWHERE\b\s+/i.exec(sql);
  if (!m || m.index === undefined) return '';
  const after = sql.slice(m.index + m[0].length);
  if (!after) return '';

  const upper = after.toUpperCase();
  let end = after.length;
  for (const kw of [' ORDER ', ' GROUP ', ' LIMIT ', ' HAVING ', ' UNION ']) {
    const idx = upper.indexOf(kw);
    if (idx !== -1 && idx < end) end = idx;
  }
  return after.slice(0, end);
}

function extractWhereColumns(sql: string): string[] {
  const wherePart = extractWherePart(sql);
  if (!wherePart) return [];
  const cols = new Set<string>();
  const matches = wherePart.matchAll(/\b([a-zA-Z_]\w*)\s*(?:=|!=|<>|>=|<=|>|<|LIKE|ILIKE)/gi);
  for (const m of matches) {
    const col = m[1].toLowerCase();
    // skip SQL keywords that can appear before operators
    if (!['and', 'or', 'not', 'col'].includes(col)) {
      cols.add(col);
    }
  }
  return [...cols];
}

export class RulesAnalyzer {
  private readonly records = new Map<string, QueryRecord>();

  analyze(event: QueryEvent, config: Config): AnalyzerResult | null {
    // Reject NaN / negative — both break detection silently at runtime.
    // NaN: `durationMs >= NaN` is always false → slow-query detection dead.
    // Negative: `durationMs >= -1` is always true → every query fires an alert.
    const raw = Number(config.threshold ?? 500);
    const threshold = raw >= 0 ? raw : 500;

    const n1 = this.checkN1(event);
    if (n1) return n1;

    if (isFullTableScan(event.sanitizedSql)) {
      return {
        issue: 'full_table_scan',
        description: `SELECT without WHERE scans every row in the table.`,
        fix: 'Add a WHERE clause or LIMIT to restrict the result set.',
        estimatedImpact: 'Eliminates full table scan — reduces I/O proportionally to table size.',
      };
    }

    if (event.durationMs >= threshold) {
      return this.slowQueryResult(event, threshold);
    }

    return null;
  }

  private checkN1(event: QueryEvent): AnalyzerResult | null {
    if (this.records.size >= MAX_TRACKED_QUERIES) this.records.clear();

    const key = event.sanitizedSql;
    const now = Date.now();
    const rec = this.records.get(key);

    if (!rec || now - rec.firstSeenMs > N1_WINDOW_MS) {
      this.records.set(key, { count: 1, firstSeenMs: now });
      return null;
    }

    rec.count++;

    if (rec.count > N1_THRESHOLD) {
      return {
        issue: 'n_plus_one',
        description: `Same query executed ${rec.count} times within ${N1_WINDOW_MS}ms — N+1 pattern detected.`,
        fix: 'Replace repeated queries with a JOIN or use eager loading (e.g. include/preload).',
        estimatedImpact: `Reduces ${rec.count} round-trips to 1 — up to ${rec.count}× fewer database calls.`,
      };
    }

    return null;
  }

  private slowQueryResult(event: QueryEvent, threshold: number): AnalyzerResult {
    const cols = extractWhereColumns(event.sanitizedSql);

    if (cols.length > 0) {
      const indexName = `idx_${cols.join('_')}`;
      return {
        issue: 'missing_index',
        description: `Query took ${event.durationMs}ms — possible missing index on: ${cols.join(', ')}.`,
        fix: `CREATE INDEX ${indexName} ON <table> (${cols.join(', ')});`,
        estimatedImpact: 'Index lookup reduces O(n) scan to O(log n) — typically 10-1000× faster.',
      };
    }

    return {
      issue: 'slow_query',
      description: `Query took ${event.durationMs}ms — exceeds ${threshold}ms threshold.`,
      fix: 'Run EXPLAIN ANALYZE to inspect the query plan. Consider indexes or query rewrite.',
      estimatedImpact: 'Depends on query complexity and data volume.',
    };
  }
}
