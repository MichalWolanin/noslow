import { sqlSentinel } from '../index';
import { consoleNotifier } from '../notifiers/console';

jest.mock('../notifiers/console', () => ({ consoleNotifier: jest.fn() }));

const mockConsole = consoleNotifier as jest.MockedFunction<typeof consoleNotifier>;

function makeMockPool(durationMs = 600) {
  return {
    query: jest.fn().mockImplementation((_sql: unknown, cb: (err: null, res: unknown) => void) => {
      setTimeout(() => cb(null, { rows: [] }), durationMs);
    }),
  };
}

function makePromisePool(resolveWith: unknown = { rows: [] }) {
  return { query: jest.fn().mockResolvedValue(resolveWith) };
}

beforeEach(() => mockConsole.mockClear());

describe('sqlSentinel - basic pipeline', () => {
  it('does not notify for fast queries', async () => {
    const pool = makePromisePool();
    const sentinel = sqlSentinel({ threshold: 500 });
    sentinel.wrapPg(pool);

    // Mock resolves instantly (0ms) — well under threshold
    await pool.query('SELECT 1');
    expect(mockConsole).not.toHaveBeenCalled();
  });

  it('notifies via console for slow query', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const sentinel = sqlSentinel({ threshold: 0 }); // threshold 0 → everything is slow
    sentinel.wrapPg(pool);

    await pool.query('SELECT * FROM events WHERE created_at BETWEEN ? AND ?');
    expect(mockConsole).toHaveBeenCalledTimes(1);
    const alert = mockConsole.mock.calls[0][0];
    expect(alert.result.issue).toBe('slow_query');
  });

  it('detects full_table_scan', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const sentinel = sqlSentinel({ threshold: 9999 });
    sentinel.wrapPg(pool);

    await pool.query('SELECT * FROM products');
    expect(mockConsole).toHaveBeenCalledTimes(1);
    expect(mockConsole.mock.calls[0][0].result.issue).toBe('full_table_scan');
  });

  it('detects n_plus_one pattern', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const sentinel = sqlSentinel({ threshold: 9999 });
    sentinel.wrapPg(pool);

    for (let i = 0; i < 7; i++) {
      await pool.query('SELECT * FROM orders WHERE user_id = $1', [i] as any);
    }
    const issues = mockConsole.mock.calls.map((c) => c[0].result.issue);
    expect(issues).toContain('n_plus_one');
  });
});

describe('sqlSentinel - rate limiting', () => {
  it('suppresses duplicate alerts within rateLimit window', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const sentinel = sqlSentinel({ threshold: 0, rateLimit: 300 });
    sentinel.wrapPg(pool);

    const sql = 'SELECT * FROM events WHERE created_at BETWEEN ? AND ?';
    await pool.query(sql);
    await pool.query(sql);
    await pool.query(sql);

    // Same issue + SQL → only first alert fires
    expect(mockConsole).toHaveBeenCalledTimes(1);
  });

  it('allows different issues through independently', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const sentinel = sqlSentinel({ threshold: 0, rateLimit: 300 });
    sentinel.wrapPg(pool);

    await pool.query('SELECT * FROM events WHERE created_at BETWEEN ? AND ?'); // slow_query
    await pool.query('SELECT * FROM products'); // full_table_scan (different id)

    expect(mockConsole).toHaveBeenCalledTimes(2);
  });
});

describe('sqlSentinel - console notifier opt-out', () => {
  it('suppresses console when notifiers.console = false', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const sentinel = sqlSentinel({ threshold: 0, notifiers: { console: false } });
    sentinel.wrapPg(pool);

    await pool.query('SELECT * FROM events WHERE created_at BETWEEN ? AND ?');
    expect(mockConsole).not.toHaveBeenCalled();
  });
});

describe('sqlSentinel - privacy local mode', () => {
  it('still fires console in local mode', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const sentinel = sqlSentinel({ threshold: 0, privacy: 'local' });
    sentinel.wrapPg(pool);

    await pool.query('SELECT * FROM events WHERE created_at BETWEEN ? AND ?');
    expect(mockConsole).toHaveBeenCalledTimes(1);
  });
});

describe('sqlSentinel - wrapMysql', () => {
  it('works with MySQL connections', async () => {
    const conn = { query: jest.fn().mockResolvedValue([[], []]), execute: jest.fn().mockResolvedValue([[], []]) };
    const sentinel = sqlSentinel({ threshold: 0 });
    sentinel.wrapMysql(conn);

    await conn.query('SELECT * FROM events WHERE created_at BETWEEN ? AND ?');
    expect(mockConsole).toHaveBeenCalledTimes(1);
    expect(mockConsole.mock.calls[0][0].queryEvent.database).toBe('mysql');
  });
});

describe('sqlSentinel - alert structure', () => {
  it('alert contains id, queryEvent and result', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const sentinel = sqlSentinel({ threshold: 0 });
    sentinel.wrapPg(pool);

    await pool.query('SELECT * FROM events WHERE created_at BETWEEN ? AND ?');
    const alert = mockConsole.mock.calls[0][0];

    expect(typeof alert.id).toBe('string');
    expect(alert.id.length).toBe(16);
    expect(alert.queryEvent).toBeDefined();
    expect(alert.result).toBeDefined();
  });
});
