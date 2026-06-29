import { consoleNotifier } from '../notifiers/console';
import { Alert } from '../types';

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 'test-hash-001',
    queryEvent: {
      sql: "SELECT * FROM orders WHERE user_id = 5",
      sanitizedSql: 'SELECT * FROM orders WHERE user_id = ?',
      durationMs: 820,
      database: 'pg',
      timestamp: new Date(),
      endpoint: 'GET /api/orders',
    },
    result: {
      issue: 'slow_query',
      description: 'Query took 820ms — exceeds 500ms threshold.',
      fix: 'Run EXPLAIN ANALYZE to inspect the query plan.',
      estimatedImpact: 'Depends on query complexity.',
    },
    ...overrides,
  };
}

describe('consoleNotifier', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('calls console.log once per alert', () => {
    consoleNotifier(makeAlert());
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('includes the issue label', () => {
    consoleNotifier(makeAlert());
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain('SLOW QUERY');
  });

  it('includes sanitized SQL (not raw)', () => {
    consoleNotifier(makeAlert());
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain('SELECT * FROM orders WHERE user_id = ?');
    expect(output).not.toContain('user_id = 5');
  });

  it('includes duration, fix and impact', () => {
    consoleNotifier(makeAlert());
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain('820ms');
    expect(output).toContain('EXPLAIN ANALYZE');
    expect(output).toContain('Depends on query complexity');
  });

  it('includes endpoint when present', () => {
    consoleNotifier(makeAlert());
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain('GET /api/orders');
  });

  it('omits endpoint when not present', () => {
    const alert = makeAlert();
    delete alert.queryEvent.endpoint;
    consoleNotifier(alert);
    const firstLine = (logSpy.mock.calls[0][0] as string).split('\n')[0];
    expect(firstLine).not.toContain('undefined');
    expect(firstLine).not.toContain(' — ');
  });

  it('shows correct label for each issue type', () => {
    const issues: Array<[Alert['result']['issue'], string]> = [
      ['n_plus_one', 'N+1 DETECTED'],
      ['slow_query', 'SLOW QUERY'],
      ['full_table_scan', 'FULL TABLE SCAN'],
      ['missing_index', 'MISSING INDEX'],
    ];

    for (const [issue, expectedLabel] of issues) {
      logSpy.mockClear();
      consoleNotifier(makeAlert({ result: { ...makeAlert().result, issue } }));
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain(expectedLabel);
    }
  });

  it('includes database type', () => {
    consoleNotifier(makeAlert());
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain('PG');
  });
});
