import { Config, QueryEvent } from '../types';
import { sanitizeSql } from '../privacy/sanitizer';

type AnyFn = (...args: unknown[]) => unknown;
type MysqlTarget = Record<string, unknown>;

function extractSql(args: unknown[]): string {
  const first = args[0];
  if (typeof first === 'string') return first;
  if (first !== null && typeof first === 'object') {
    if ('sql' in first) return (first as { sql: string }).sql;
  }
  return '';
}

function extractParams(args: unknown[]): unknown[] | undefined {
  const first = args[0];
  if (first !== null && typeof first === 'object' && 'values' in first) {
    const vals = (first as { values: unknown }).values;
    return Array.isArray(vals) ? vals : undefined;
  }
  const second = args[1];
  return Array.isArray(second) ? second : undefined;
}

function patchMethod(
  target: MysqlTarget,
  method: 'query' | 'execute',
  privacy: Config['privacy'],
  emit: (event: QueryEvent) => void
): void {
  if (typeof target[method] !== 'function') return;

  const original = (target[method] as AnyFn).bind(target);
  const privacyMode = privacy ?? 'safe';

  target[method] = function (...args: unknown[]) {
    const startMs = Date.now();
    const rawSql = extractSql(args);
    const params = extractParams(args);

    const finish = (durationMs: number) => {
      try {
        const event: QueryEvent = {
          sql: rawSql,
          sanitizedSql: sanitizeSql(rawSql, privacyMode),
          durationMs,
          database: 'mysql',
          timestamp: new Date(),
          ...(params !== undefined && { params }),
        };
        emit(event);
      } catch {
        // never crash the developer's app
      }
    };

    // Callback-style: query(sql, values?, callback)
    const lastArg = args[args.length - 1];
    if (typeof lastArg === 'function') {
      const cb = lastArg as (err: unknown, result: unknown, fields: unknown) => void;
      args[args.length - 1] = (err: unknown, result: unknown, fields: unknown) => {
        finish(Date.now() - startMs);
        cb(err, result, fields);
      };
      return original(...args);
    }

    // Promise-style (mysql2/promise)
    const result = original(...args);
    if (result !== null && typeof result === 'object' && typeof (result as Promise<unknown>).then === 'function') {
      return (result as Promise<unknown>).then(
        (res) => { finish(Date.now() - startMs); return res; },
        (err: unknown) => { finish(Date.now() - startMs); throw err; }
      );
    }

    return result;
  };
}

export function patchMysql(
  target: unknown,
  config: Config,
  emit: (event: QueryEvent) => void
): void {
  const t = target as MysqlTarget;
  patchMethod(t, 'query', config.privacy, emit);
  patchMethod(t, 'execute', config.privacy, emit);
}
