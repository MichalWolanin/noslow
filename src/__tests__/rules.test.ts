import { RulesAnalyzer } from '../analyzers/rules';
import { QueryEvent, Config } from '../types';

function makeEvent(overrides: Partial<QueryEvent> = {}): QueryEvent {
  return {
    sql: 'SELECT * FROM users WHERE id = 1',
    sanitizedSql: 'SELECT * FROM users WHERE id = ?',
    durationMs: 10,
    database: 'pg',
    timestamp: new Date(),
    ...overrides,
  };
}

const config: Config = { threshold: 500 };

describe('RulesAnalyzer - slow_query', () => {
  it('returns null when query is fast', () => {
    const analyzer = new RulesAnalyzer();
    expect(analyzer.analyze(makeEvent({ durationMs: 100 }), config)).toBeNull();
  });

  it('returns slow_query when durationMs >= threshold and no extractable columns', () => {
    const analyzer = new RulesAnalyzer();
    // BETWEEN is not in the operator list, so no columns are extracted → pure slow_query
    const result = analyzer.analyze(
      makeEvent({ durationMs: 600, sanitizedSql: 'SELECT * FROM events WHERE created_at BETWEEN ? AND ?' }),
      config
    );
    expect(result?.issue).toBe('slow_query');
    expect(result?.description).toContain('600ms');
    expect(result?.description).toContain('500ms');
  });

  it('uses default threshold of 500ms when not configured', () => {
    const analyzer = new RulesAnalyzer();
    const result = analyzer.analyze(
      makeEvent({ durationMs: 501, sanitizedSql: 'SELECT * FROM events WHERE created_at BETWEEN ? AND ?' }),
      {}
    );
    expect(result?.issue).toBe('slow_query');
  });
});

describe('RulesAnalyzer - missing_index', () => {
  it('returns missing_index when slow query has WHERE columns', () => {
    const analyzer = new RulesAnalyzer();
    const result = analyzer.analyze(
      makeEvent({
        durationMs: 800,
        sanitizedSql: 'SELECT * FROM orders WHERE user_id = ? AND status = ?',
      }),
      config
    );
    expect(result?.issue).toBe('missing_index');
    expect(result?.description).toContain('user_id');
    expect(result?.description).toContain('status');
    expect(result?.fix).toContain('CREATE INDEX');
    expect(result?.fix).toContain('user_id');
    expect(result?.fix).toContain('status');
  });

  it('extracts single WHERE column', () => {
    const analyzer = new RulesAnalyzer();
    const result = analyzer.analyze(
      makeEvent({
        durationMs: 700,
        sanitizedSql: 'SELECT * FROM users WHERE email = ?',
      }),
      config
    );
    expect(result?.issue).toBe('missing_index');
    expect(result?.fix).toContain('email');
  });
});

describe('RulesAnalyzer - full_table_scan', () => {
  it('detects SELECT without WHERE', () => {
    const analyzer = new RulesAnalyzer();
    const result = analyzer.analyze(
      makeEvent({ sanitizedSql: 'SELECT * FROM users', durationMs: 10 }),
      config
    );
    expect(result?.issue).toBe('full_table_scan');
    expect(result?.fix).toContain('WHERE');
  });

  it('does not flag SELECT with WHERE as full table scan', () => {
    const analyzer = new RulesAnalyzer();
    const result = analyzer.analyze(
      makeEvent({ sanitizedSql: 'SELECT * FROM users WHERE active = ?', durationMs: 10 }),
      config
    );
    expect(result).toBeNull();
  });

  it('does not flag non-SELECT statements without WHERE', () => {
    const analyzer = new RulesAnalyzer();
    const result = analyzer.analyze(
      makeEvent({ sanitizedSql: 'INSERT INTO logs (msg) VALUES (?)', durationMs: 10 }),
      config
    );
    expect(result).toBeNull();
  });

  it('does not flag SELECT without FROM', () => {
    const analyzer = new RulesAnalyzer();
    const result = analyzer.analyze(
      makeEvent({ sanitizedSql: 'SELECT NOW()', durationMs: 10 }),
      config
    );
    expect(result).toBeNull();
  });
});

describe('RulesAnalyzer - n_plus_one', () => {
  it('returns null for first few occurrences', () => {
    const analyzer = new RulesAnalyzer();
    const event = makeEvent({ sanitizedSql: 'SELECT * FROM orders WHERE user_id = ?' });
    for (let i = 0; i < 5; i++) {
      expect(analyzer.analyze(event, config)).toBeNull();
    }
  });

  it('returns n_plus_one after 5+ identical queries in window', () => {
    const analyzer = new RulesAnalyzer();
    const event = makeEvent({ sanitizedSql: 'SELECT * FROM orders WHERE user_id = ?' });
    let result = null;
    for (let i = 0; i < 7; i++) {
      result = analyzer.analyze(event, config);
    }
    expect(result?.issue).toBe('n_plus_one');
    expect(result?.description).toContain('N+1');
    expect(result?.fix).toContain('JOIN');
  });

  it('does not mix up different queries', () => {
    const analyzer = new RulesAnalyzer();
    for (let i = 0; i < 7; i++) {
      analyzer.analyze(makeEvent({ sanitizedSql: 'SELECT * FROM orders WHERE user_id = ?' }), config);
    }
    const result = analyzer.analyze(
      makeEvent({ sanitizedSql: 'SELECT * FROM users WHERE id = ?' }),
      config
    );
    expect(result).toBeNull();
  });

  it('resets count after time window expires', async () => {
    const analyzer = new RulesAnalyzer();
    // Access private field for testing - simulate time passing by directly manipulating records
    const event = makeEvent({ sanitizedSql: 'SELECT * FROM posts WHERE author_id = ?' });
    for (let i = 0; i < 6; i++) {
      analyzer.analyze(event, config);
    }

    // Manually expire the window
    const records = (analyzer as unknown as { records: Map<string, { count: number; firstSeenMs: number }> }).records;
    const rec = records.get(event.sanitizedSql)!;
    rec.firstSeenMs = Date.now() - 2000; // 2 seconds ago

    // After window reset, first occurrence again — should not flag N+1
    const result = analyzer.analyze(event, config);
    expect(result).toBeNull();
  });

  it('n_plus_one takes priority over full_table_scan', () => {
    const analyzer = new RulesAnalyzer();
    const event = makeEvent({ sanitizedSql: 'SELECT * FROM products' }); // no WHERE
    let result = null;
    for (let i = 0; i < 7; i++) {
      result = analyzer.analyze(event, config);
    }
    expect(result?.issue).toBe('n_plus_one');
  });
});
