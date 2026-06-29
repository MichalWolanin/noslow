import { Config, QueryEvent } from '../types';
import { sanitizeSql } from '../privacy/sanitizer';

type QueryFn = (...args: unknown[]) => unknown;
type PgTarget = { query: QueryFn };

function extractSql(args: unknown[]): string {
  const first = args[0];
  if (typeof first === 'string') return first;
  if (first !== null && typeof first === 'object' && 'text' in first) {
    return (first as { text: string }).text;
  }
  return '';
}

function extractParams(args: unknown[]): unknown[] | undefined {
  const second = args[1];
  return Array.isArray(second) ? second : undefined;
}

export function patchPg(
  target: unknown,
  config: Config,
  emit: (event: QueryEvent) => void
): void {
  const t = target as PgTarget;
  const original = t.query.bind(t);
  const privacy = config.privacy ?? 'safe';

  t.query = function (...args: unknown[]) {
    const startMs = Date.now();
    const rawSql = extractSql(args);
    const params = extractParams(args);

    const finish = (durationMs: number) => {
      try {
        const event: QueryEvent = {
          sql: rawSql,
          sanitizedSql: sanitizeSql(rawSql, privacy),
          durationMs,
          database: 'pg',
          timestamp: new Date(),
          ...(params !== undefined && { params }),
        };
        emit(event);
      } catch {
        // never crash the developer's app
      }
    };

    // Callback-style query(sql, values, callback) or query(sql, callback)
    const lastArg = args[args.length - 1];
    if (typeof lastArg === 'function') {
      const cb = lastArg as (err: unknown, result: unknown) => void;
      args[args.length - 1] = (err: unknown, result: unknown) => {
        finish(Date.now() - startMs);
        cb(err, result);
      };
      return original(...args);
    }

    // Promise-style
    const promise = original(...args) as Promise<unknown>;
    return promise.then(
      (result) => { finish(Date.now() - startMs); return result; },
      (err: unknown) => { finish(Date.now() - startMs); throw err; }
    );
  };
}
