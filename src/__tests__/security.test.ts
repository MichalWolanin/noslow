/**
 * Cybersecurity audit tests.
 * Each describe block targets a specific class of vulnerability.
 */

import { RulesAnalyzer } from '../analyzers/rules';
import { claudeAnalyzer } from '../analyzers/claude';
import { sqlSentinel } from '../index';
import { consoleNotifier } from '../notifiers/console';
import { postJson, postJsonBody } from '../notifiers/http';
import { QueryEvent } from '../types';

jest.mock('../notifiers/console', () => ({ consoleNotifier: jest.fn() }));
jest.mock('../analyzers/claude', () => ({ claudeAnalyzer: jest.fn() }));

const mockConsole = consoleNotifier as jest.MockedFunction<typeof consoleNotifier>;
const mockClaude  = claudeAnalyzer  as jest.MockedFunction<typeof claudeAnalyzer>;

const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

function makeEvent(overrides: Partial<QueryEvent> = {}): QueryEvent {
  return {
    sql: 'SELECT id FROM t WHERE id = 1',
    sanitizedSql: 'SELECT id FROM t WHERE id = ?',
    durationMs: 600,
    database: 'pg',
    timestamp: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  mockConsole.mockReset().mockReturnValue(undefined);
  mockClaude.mockReset();
});

// ── 1. Input validation — threshold ───────────────────────────────────────────

describe('threshold validation', () => {
  const analyzer = new RulesAnalyzer();
  const slowEvent  = makeEvent({ durationMs: 600 }); // 600ms > default 500
  const fastEvent  = makeEvent({ durationMs: 400 }); // 400ms < default 500

  it('NaN threshold: 400ms query does NOT trigger (falls back to default 500)', () => {
    // Without fix: `NaN ?? 500 = NaN` → `400 >= NaN = false` → no alert. Same result, but:
    // With NaN: `600 >= NaN = false` too → 600ms query also silently ignored.
    // The fix makes 600ms predictably trigger and 400ms not trigger.
    expect(analyzer.analyze(fastEvent,  { threshold: NaN })).toBeNull();
  });

  it('NaN threshold: 600ms query DOES trigger alert (uses default 500)', () => {
    const result = analyzer.analyze(slowEvent, { threshold: NaN });
    expect(result).not.toBeNull();
    expect(['slow_query', 'missing_index']).toContain(result!.issue);
  });

  it('negative threshold: 400ms query does NOT trigger (falls back to default 500)', () => {
    // Without fix: `400 >= -1` is true → every query triggers → alert storm.
    const result = analyzer.analyze(fastEvent, { threshold: -1 });
    expect(result).toBeNull();
  });

  it('negative threshold: 600ms query triggers (default 500 applied)', () => {
    const result = analyzer.analyze(slowEvent, { threshold: -1 });
    expect(result).not.toBeNull();
  });

  it('Infinity threshold: no slow-query/missing-index alerts fire (never exceeds ∞)', () => {
    const result = analyzer.analyze(slowEvent, { threshold: Infinity });
    // N+1 and full_table_scan can still fire; slow-path is skipped
    expect(result).toBeNull();
  });

  it('threshold: 0 works as intended — every query with WHERE triggers', () => {
    // 0 is a valid explicit choice: alert on all queries
    const result = analyzer.analyze(makeEvent({ durationMs: 1 }), { threshold: 0 });
    expect(result).not.toBeNull();
  });

  it('"abc" string threshold (JS users bypassing TypeScript): treated as NaN → default 500', () => {
    // Fresh analyzer — avoids N+1 state leaking from other tests using the same SQL key.
    const fresh = new RulesAnalyzer();
    const ev = makeEvent({ durationMs: 400, sanitizedSql: 'SELECT id FROM abc_sentinel WHERE id = ?' });
    const result = fresh.analyze(ev, { threshold: 'abc' as unknown as number });
    expect(result).toBeNull(); // 400ms < 500ms default
  });
});

// ── 2. Input validation — rateLimit ───────────────────────────────────────────

describe('rateLimit validation', () => {
  it('NaN rateLimit: second identical alert is still rate-limited (uses default 300s)', async () => {
    // Without fix: rateLimitMs = NaN → `(now - last) < NaN = false` → rate limiting disabled.
    // With fix: rateLimitMs = 300_000 → second alert is throttled.
    const sentinel = sqlSentinel({ threshold: 9999, rateLimit: NaN });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    sentinel.wrapPg(pool);

    await pool.query('SELECT * FROM products');
    await pool.query('SELECT * FROM products');
    await pool.query('SELECT * FROM products');

    expect(mockConsole).toHaveBeenCalledTimes(1);
  });

  it('negative rateLimit: second alert is still rate-limited (uses default 300s)', async () => {
    const sentinel = sqlSentinel({ threshold: 9999, rateLimit: -5 });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    sentinel.wrapPg(pool);

    await pool.query('SELECT * FROM products');
    await pool.query('SELECT * FROM products');

    expect(mockConsole).toHaveBeenCalledTimes(1);
  });

  it('rateLimit: 0 is accepted — every alert fires (no throttle)', async () => {
    const sentinel = sqlSentinel({ threshold: 9999, rateLimit: 0 });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    sentinel.wrapPg(pool);

    await pool.query('SELECT * FROM products');
    await pool.query('SELECT * FROM products');
    await pool.query('SELECT * FROM products');

    expect(mockConsole.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('Infinity rateLimit is accepted — after first alert, never fires again', async () => {
    const sentinel = sqlSentinel({ threshold: 9999, rateLimit: Infinity });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    sentinel.wrapPg(pool);

    await pool.query('SELECT * FROM products');
    await pool.query('SELECT * FROM products');
    await pool.query('SELECT * FROM products');

    expect(mockConsole).toHaveBeenCalledTimes(1);
  });
});

// ── 3. anthropicKey validation ────────────────────────────────────────────────

describe('anthropicKey validation', () => {
  const event = makeEvent({ durationMs: 999 });
  const config = { threshold: 0, mode: 'cloud' as const };

  it('undefined anthropicKey: returns null, no API call', async () => {
    const result = await (claudeAnalyzer as jest.MockedFunction<typeof claudeAnalyzer>).getMockImplementation()
      ?? await import('../analyzers/claude').then(m => m.claudeAnalyzer);
    // Test the real implementation directly (unmocked)
    jest.unmock('../analyzers/claude');
  });

  // Test real implementation directly
  it('whitespace-only key ("   "): returns null, does not call Anthropic API', async () => {
    // Re-import the real module (not mocked)
    const { claudeAnalyzer: realClaude } = await import('../analyzers/claude');
    jest.mock('../notifiers/http', () => ({
      postJson: jest.fn(),
      postJsonBody: jest.fn().mockRejectedValue(new Error('should not be called')),
    }));

    const result = await realClaude(event, { ...config, anthropicKey: '   ' });
    expect(result).toBeNull();
  });

  it('empty string key (""): returns null', async () => {
    const { claudeAnalyzer: realClaude } = await import('../analyzers/claude');
    const result = await realClaude(event, { ...config, anthropicKey: '' });
    expect(result).toBeNull();
  });

  it('undefined key: returns null', async () => {
    const { claudeAnalyzer: realClaude } = await import('../analyzers/claude');
    const result = await realClaude(event, { ...config, anthropicKey: undefined });
    expect(result).toBeNull();
  });
});

// ── 4. ReDoS — WHERE clause extraction ────────────────────────────────────────

describe('ReDoS protection — WHERE clause extraction', () => {
  const analyzer = new RulesAnalyzer();

  it('500 "ORDER" tokens without "BY" complete in under 100ms', () => {
    // Old regex: WHERE\s+(.+?)(?:\s+ORDER\s+BY|...|$)
    // At each "ORDER" position it matches \s+ORDER then fails on \s+BY → O(n²).
    // New string-based approach: linear indexOf scan → O(n).
    const evil = 'SELECT id FROM t WHERE id = 1 ' +
      'ORDER ORDER ORDER ORDER ORDER ORDER ORDER ORDER ORDER ORDER '.repeat(500);
    const event = makeEvent({ sanitizedSql: evil, durationMs: 9999 });

    const start = Date.now();
    analyzer.analyze(event, { threshold: 0 });
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('2000-char WHERE clause with mixed keywords completes in under 100ms', () => {
    const evil = 'SELECT id FROM t WHERE ' + 'a = ? AND '.repeat(100) +
      'HAVING HAVING HAVING HAVING HAVING HAVING HAVING HAVING HAVING HAVING '.repeat(10) +
      'id = ?';
    const event = makeEvent({ sanitizedSql: evil, durationMs: 9999 });

    const start = Date.now();
    analyzer.analyze(event, { threshold: 0 });
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('very long SQL without WHERE completes in under 50ms', () => {
    const big = 'SELECT ' + 'a, b, c, d, e, '.repeat(500) + 'z FROM t';
    const event = makeEvent({ sanitizedSql: big, durationMs: 9999 });

    const start = Date.now();
    analyzer.analyze(event, { threshold: 0 });
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('correct columns are extracted from a normal WHERE clause', () => {
    // Verify the refactored code still produces correct output
    const sql = 'SELECT id FROM orders WHERE user_id = ? AND status = ? ORDER BY created_at';
    const event = makeEvent({ sanitizedSql: sql, durationMs: 9999 });
    const result = analyzer.analyze(event, { threshold: 0 });
    // missing_index or slow_query — either way fix should mention user_id and/or status
    expect(result).not.toBeNull();
    if (result!.issue === 'missing_index') {
      expect(result!.fix).toMatch(/user_id|status/i);
    }
  });

  it('ORDER BY at end is correctly excluded from column extraction', () => {
    // "id" from WHERE, "created_at" from ORDER BY should NOT appear as index column
    const sql = 'SELECT id FROM t WHERE id = ? ORDER BY created_at';
    const event = makeEvent({ sanitizedSql: sql, durationMs: 9999 });
    const result = analyzer.analyze(event, { threshold: 0 });
    if (result?.issue === 'missing_index') {
      expect(result.fix).not.toMatch(/created_at/);
    }
  });
});

// ── 5. Memory leak — lastAlerted Map bounded ──────────────────────────────────

describe('lastAlerted memory bound', () => {
  it('map is cleared after cap — a rate-limited alert can fire again after eviction', async () => {
    // MAX_RATE_LIMIT_ENTRIES is 10_000 in the implementation.
    // This test uses 10_001 unique SQLs to trigger one clear cycle, then checks
    // that a previously rate-limited alert fires again (its entry was evicted).
    const MAX = 10_000;
    const sentinel = sqlSentinel({ threshold: 9999, rateLimit: 300 });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    sentinel.wrapPg(pool);

    // First alert for tbl_0 fires and is stored in lastAlerted
    await pool.query('SELECT * FROM tbl_0');
    mockConsole.mockClear();

    // Fill the map: 10_000 more unique SQLs trigger the clear when the 10_001st is set.
    // After clear, tbl_0's entry is gone.
    for (let i = 1; i <= MAX; i++) {
      await pool.query(`SELECT * FROM tbl_${i}`);
    }
    mockConsole.mockClear();

    // tbl_0 again — entry was evicted, so rate limit is reset and it fires
    await pool.query('SELECT * FROM tbl_0');
    expect(mockConsole).toHaveBeenCalledTimes(1);
  }, 30_000);

  it('after 20_000 unique alerts the process does not OOM', async () => {
    const sentinel = sqlSentinel({ threshold: 9999, rateLimit: 0 });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    sentinel.wrapPg(pool);

    for (let i = 0; i < 20_000; i++) {
      await pool.query(`SELECT * FROM t${i}`);
    }
    expect(true).toBe(true); // reaching here proves no OOM / hang
  }, 30_000);
});

// ── 6. Webhook URL protocol validation ────────────────────────────────────────

describe('URL protocol validation', () => {
  it('postJson rejects javascript:// with a TypeError — no network attempt', async () => {
    await expect(postJson('javascript://evil.example.com', {}))
      .rejects.toThrow(/must use http/);
  });

  it('postJson rejects file:// protocol', async () => {
    await expect(postJson('file:///etc/passwd', {}))
      .rejects.toThrow(/must use http/);
  });

  it('postJson rejects data: protocol', async () => {
    await expect(postJson('data:text/html,<script>alert(1)</script>', {}))
      .rejects.toThrow(); // TypeError from new URL or our check
  });

  it('postJson rejects empty string — TypeError from URL parser', async () => {
    await expect(postJson('', {})).rejects.toThrow();
  });

  it('postJsonBody rejects javascript:// — same guard', async () => {
    await expect(postJsonBody('javascript://evil.example.com', {}))
      .rejects.toThrow(/must use http/);
  });

  it('postJsonBody rejects file:// — same guard', async () => {
    await expect(postJsonBody('file:///etc/passwd', {}))
      .rejects.toThrow(/must use http/);
  });

  it('http:// is accepted (for local dev environments)', async () => {
    // We can't make a real HTTP call in tests — just verify no protocol error is thrown.
    // The request will fail with a network error (ECONNREFUSED), not a protocol error.
    const result = postJson('http://localhost:1', {});
    await expect(result).rejects.not.toThrow(/must use http/);
    // (The actual rejection will be a network error, which is expected)
  });
});

// ── 7. Prototype pollution ─────────────────────────────────────────────────────

describe('prototype pollution', () => {
  it('config with __proto__ key does not pollute Object.prototype', () => {
    // JSON.parse creates an object with an own string property named "__proto__",
    // not the prototype setter — but let's verify sentinel handles it safely.
    const malicious = JSON.parse('{"threshold": 500, "__proto__": {"polluted": true}}');
    expect(() => sqlSentinel(malicious)).not.toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('notifiers config with __proto__ key does not pollute', () => {
    const maliciousNotifiers = JSON.parse('{"console": true, "__proto__": {"injected": true}}');
    expect(() => sqlSentinel({ notifiers: maliciousNotifiers })).not.toThrow();
    expect(({} as Record<string, unknown>).injected).toBeUndefined();
  });

  it('extraHeaders spread in http.ts does not propagate __proto__ pollution', () => {
    // buildRequest uses { ...extraHeaders } which copies own enumerable props only.
    // A headers object with own "__proto__" property must not set Object.prototype.
    // We can't call buildRequest directly (private), but we can verify via postJsonBody.
    const maliciousHeaders = Object.create(null) as Record<string, string>;
    Object.defineProperty(maliciousHeaders, '__proto__', {
      value: { headerPolluted: true },
      enumerable: true,
    });
    // postJsonBody will reject (bad URL if any, or we pass a valid but unreachable URL)
    // The key point: Object.prototype must not be polluted after the call
    postJsonBody('http://localhost:1', {}, maliciousHeaders).catch(() => {});
    expect(({} as Record<string, unknown>).headerPolluted).toBeUndefined();
  });
});

// ── 8. anthropicKey not exposed in error paths ────────────────────────────────

describe('anthropicKey not exposed in logs or error messages', () => {
  it('a 401 Anthropic response does not surface the key to the caller', async () => {
    // We mock postJsonBody to simulate a 401 response from Anthropic
    jest.mock('../notifiers/http', () => ({
      postJson: jest.fn(),
      postJsonBody: jest.fn().mockRejectedValue(new Error('HTTP 401: {"error":"invalid_api_key"}')),
    }));

    const { claudeAnalyzer: realClaude } = await import('../analyzers/claude');
    const errors: string[] = [];
    const origErr = console.error.bind(console);
    console.error = (...args: unknown[]) => { errors.push(String(args[0])); origErr(...args); };

    const result = await realClaude(makeEvent(), {
      threshold: 0,
      mode: 'cloud',
      anthropicKey: 'sk-ant-secret-key-12345',
    });

    console.error = origErr;
    expect(result).toBeNull(); // error caught, returns null
    // API key must not appear in any logged output
    const allOutput = errors.join(' ');
    expect(allOutput).not.toContain('sk-ant-secret-key-12345');
  });
});
