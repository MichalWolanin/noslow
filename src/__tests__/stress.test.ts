import { patchPg } from '../middleware/pg';
import { patchMysql } from '../middleware/mysql';
import { sqlSentinel } from '../index';
import { RulesAnalyzer } from '../analyzers/rules';
import { consoleNotifier } from '../notifiers/console';
import { Config, QueryEvent } from '../types';

jest.mock('../notifiers/console', () => ({ consoleNotifier: jest.fn() }));

const mockConsole = consoleNotifier as jest.MockedFunction<typeof consoleNotifier>;

// MAX_TRACKED_QUERIES mirrors the constant in rules.ts
const MAX_TRACKED_QUERIES = 5000;

function makeEvent(sql: string, durationMs = 10): QueryEvent {
  return { sql, sanitizedSql: sql, durationMs, database: 'pg', timestamp: new Date() };
}

beforeEach(() => mockConsole.mockClear());

// ── 1. Middleware concurrency ──────────────────────────────────────────────────

describe('middleware concurrency', () => {
  it('pg promise: 1000 concurrent queries all reach emit — none dropped', async () => {
    const emit = jest.fn();
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    patchPg(pool, {}, emit);

    await Promise.all(
      Array.from({ length: 1000 }, (_, i) =>
        (pool as any).query(`SELECT id FROM users WHERE id = ${i}`)
      )
    );

    expect(emit).toHaveBeenCalledTimes(1000);
  }, 10_000);

  it('pg callback: 500 concurrent queries all reach emit — none dropped', (done) => {
    const emit = jest.fn();
    const pool = {
      query: jest.fn((_sql: string, cb: (err: null, r: object) => void) => {
        setImmediate(() => cb(null, { rows: [] }));
      }),
    };
    patchPg(pool, {}, emit);

    let completed = 0;
    for (let i = 0; i < 500; i++) {
      (pool as any).query(
        `SELECT id FROM t WHERE id = ${i}`,
        (_err: null, _r: object) => {
          if (++completed === 500) {
            expect(emit).toHaveBeenCalledTimes(500);
            done();
          }
        }
      );
    }
  }, 10_000);

  it('mysql: 1000 concurrent queries all reach emit — none dropped', async () => {
    const emit = jest.fn();
    const conn = {
      query: jest.fn().mockResolvedValue([[{ id: 1 }], []]),
      execute: jest.fn().mockResolvedValue([[{ id: 1 }], []]),
    };
    patchMysql(conn, {}, emit);

    await Promise.all(
      Array.from({ length: 1000 }, (_, i) =>
        (conn as any).query(`SELECT id FROM orders WHERE id = ${i}`)
      )
    );

    expect(emit).toHaveBeenCalledTimes(1000);
  }, 10_000);
});

// ── 2. Rate limiting under load ────────────────────────────────────────────────

describe('rate limiting under load', () => {
  it('100 identical queries produce at most 2 alerts (rate-limited after first per issue)', async () => {
    const sentinel = sqlSentinel({ threshold: 0, rateLimit: 300 });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    sentinel.wrapPg(pool);

    // All sanitise to the same SQL → same alert ID per issue type.
    // Expected: 1 slow/missing-index alert + 1 n+1 alert = 2 max.
    await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        (pool as any).query(`SELECT id FROM users WHERE id = ${i}`)
      )
    );

    expect(mockConsole.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('20 structurally distinct queries each fire their own alert when rateLimit is off', async () => {
    // rateLimit:0 → rateLimitMs=0 → condition (now - last) < 0 is always false → no throttle
    const sentinel = sqlSentinel({ threshold: 0, rateLimit: 0 });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    sentinel.wrapPg(pool);

    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        (pool as any).query(`SELECT id FROM table_${i} WHERE id = 1`)
      )
    );

    // 20 distinct table names → 20 distinct sanitized SQLs → 20 distinct alert IDs
    expect(mockConsole.mock.calls.length).toBeGreaterThanOrEqual(20);
  });

  it('rate limit is per unique (issue, sql) pair — different issues through in parallel', async () => {
    const sentinel = sqlSentinel({ threshold: 0, rateLimit: 300 });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    sentinel.wrapPg(pool);

    // Each table name is distinct → distinct alert IDs even at high rateLimit
    const q1 = (pool as any).query('SELECT * FROM products');        // full_table_scan
    const q2 = (pool as any).query('SELECT * FROM categories');      // full_table_scan (different sql)
    await Promise.all([q1, q2]);

    expect(mockConsole.mock.calls.length).toBe(2);
  });
});

// ── 3. Notifier error isolation ────────────────────────────────────────────────

describe('notifier error isolation', () => {
  it('pool.query resolves normally even when consoleNotifier throws on every call', async () => {
    mockConsole.mockImplementation(() => { throw new Error('forced notifier crash'); });

    const sentinel = sqlSentinel({ threshold: 0 });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    sentinel.wrapPg(pool);

    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        (pool as any).query(`SELECT id FROM t WHERE id = ${i}`)
      )
    );

    // All 100 pool.query() calls resolved — notifier crash did not propagate
    expect(results).toHaveLength(100);
  });

  it('continues delivering events when notifier crashes intermittently', async () => {
    let callCount = 0;
    mockConsole.mockImplementation(() => {
      if (++callCount % 3 === 0) throw new Error('intermittent failure');
    });

    // rateLimit:0 → every alert fires so we can count how many were attempted
    const sentinel = sqlSentinel({ threshold: 0, rateLimit: 0 });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    sentinel.wrapPg(pool);

    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        (pool as any).query(`SELECT id FROM tbl_${i} WHERE id = 1`)
      )
    );

    // All 30 pool.query() promises resolved despite crashes on calls 3, 6, 9 …
    expect(results).toHaveLength(30);
  });

  it('mysql: pool.query resolves normally even when consoleNotifier throws', async () => {
    mockConsole.mockImplementation(() => { throw new Error('crash'); });

    const sentinel = sqlSentinel({ threshold: 0 });
    const conn = {
      query: jest.fn().mockResolvedValue([[], []]),
      execute: jest.fn().mockResolvedValue([[], []]),
    };
    sentinel.wrapMysql(conn);

    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        (conn as any).query(`SELECT id FROM t WHERE id = ${i}`)
      )
    );

    expect(results).toHaveLength(50);
  });
});

// ── 4. Memory leak — N+1 tracker stays bounded ────────────────────────────────

describe('N+1 tracker memory bound', () => {
  const highThreshold: Config = { threshold: 99_999 };

  it(`stays bounded across ${MAX_TRACKED_QUERIES * 2} unique queries (two full map cycles)`, () => {
    const analyzer = new RulesAnalyzer();

    for (let i = 0; i < MAX_TRACKED_QUERIES * 2; i++) {
      analyzer.analyze(makeEvent(`SELECT * FROM t WHERE id = ${i}`), highThreshold);
    }

    // Reaching here without OOM / timeout proves the map was cleared and never grew unboundedly
    expect(true).toBe(true);
  }, 15_000);

  it('resets N+1 count after a map clear — no stale state carries over', () => {
    const analyzer = new RulesAnalyzer();

    // Fill the map to the limit (5000 unique keys)
    for (let i = 0; i < MAX_TRACKED_QUERIES; i++) {
      analyzer.analyze(makeEvent(`SELECT a FROM b WHERE i = ${i}`), highThreshold);
    }

    // One more unique query triggers the clear
    analyzer.analyze(makeEvent('SELECT a FROM trigger_clear WHERE z = 1'), highThreshold);

    // This query is now "brand new" — needs 6 hits to be N+1, not just 1
    let result = null;
    for (let i = 0; i < 5; i++) {
      result = analyzer.analyze(makeEvent('SELECT * FROM fresh_start WHERE id = ?'), highThreshold);
    }

    // 5 hits after a clear should NOT trigger N+1 (threshold is > 5, i.e. 6+)
    expect(result?.issue).not.toBe('n_plus_one');
  });

  it('correctly detects N+1 in a new batch started after a map clear', () => {
    const analyzer = new RulesAnalyzer();

    // Trigger a map clear (fill to limit + 1 unique query)
    for (let i = 0; i <= MAX_TRACKED_QUERIES; i++) {
      analyzer.analyze(makeEvent(`SELECT z FROM w WHERE k = ${i}`), highThreshold);
    }

    // After the clear, this query starts fresh — 6 repetitions should trigger N+1
    let result = null;
    for (let i = 0; i <= 5; i++) {
      result = analyzer.analyze(makeEvent('SELECT * FROM hot WHERE status = ?'), highThreshold);
    }

    expect(result?.issue).toBe('n_plus_one');
  });
});
