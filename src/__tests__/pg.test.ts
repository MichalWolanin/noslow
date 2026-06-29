import { patchPg } from '../middleware/pg';
import { QueryEvent, Config } from '../types';

function makeMockPool(result: unknown = { rows: [] }) {
  return {
    query: jest.fn().mockResolvedValue(result),
  };
}

function makeMockPoolCallback(result: unknown = { rows: [] }) {
  return {
    query: jest.fn().mockImplementation(
      (_sql: unknown, _vals: unknown, cb: (err: null, res: unknown) => void) => cb(null, result)
    ),
  };
}

const config: Config = { privacy: 'safe', threshold: 500 };

describe('patchPg', () => {
  it('emits QueryEvent after promise-style query', async () => {
    const pool = makeMockPool();
    const events: QueryEvent[] = [];

    patchPg(pool, config, (e) => events.push(e));
    await pool.query("SELECT * FROM users WHERE email = 'jan@firma.pl'");

    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.database).toBe('pg');
    expect(event.sql).toBe("SELECT * FROM users WHERE email = 'jan@firma.pl'");
    expect(event.sanitizedSql).toBe('SELECT * FROM users WHERE email = ?');
    expect(event.durationMs).toBeGreaterThanOrEqual(0);
    expect(event.timestamp).toBeInstanceOf(Date);
  });

  it('extracts sql from QueryConfig object ({ text })', async () => {
    const pool = makeMockPool();
    const events: QueryEvent[] = [];

    patchPg(pool, config, (e) => events.push(e));
    await pool.query({ text: 'SELECT $1::text', values: ['hello'] } as any);

    expect(events[0].sql).toBe('SELECT $1::text');
  });

  it('captures params when provided as array', async () => {
    const pool = makeMockPool();
    const events: QueryEvent[] = [];

    patchPg(pool, config, (e) => events.push(e));
    await pool.query('SELECT * FROM users WHERE id = $1', [42] as any);

    expect(events[0].params).toEqual([42]);
  });

  it('emits event even when query rejects', async () => {
    const pool = { query: jest.fn().mockRejectedValue(new Error('db error')) };
    const events: QueryEvent[] = [];

    patchPg(pool, config, (e) => events.push(e));
    await expect(pool.query('SELECT 1')).rejects.toThrow('db error');

    expect(events).toHaveLength(1);
  });

  it('applies paranoid privacy mode', async () => {
    const pool = makeMockPool();
    const events: QueryEvent[] = [];

    patchPg(pool, { privacy: 'paranoid' }, (e) => events.push(e));
    await pool.query("SELECT * FROM users WHERE email = 'jan@firma.pl'");

    expect(events[0].sanitizedSql).toBe('SELECT * FROM [table] WHERE [col] = ?');
  });

  it('does not crash the app when emit throws', async () => {
    const pool = makeMockPool();

    patchPg(pool, config, () => { throw new Error('notifier failure'); });
    await expect(pool.query('SELECT 1')).resolves.not.toThrow();
  });

  it('emits QueryEvent for callback-style query', (done) => {
    const pool = makeMockPoolCallback();
    const events: QueryEvent[] = [];

    patchPg(pool, config, (e) => events.push(e));
    pool.query('SELECT 1', [], (err: null, _res: unknown) => {
      expect(err).toBeNull();
      expect(events).toHaveLength(1);
      expect(events[0].database).toBe('pg');
      done();
    });
  });
});
