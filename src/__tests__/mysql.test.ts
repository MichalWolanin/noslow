import { patchMysql } from '../middleware/mysql';
import { QueryEvent, Config } from '../types';

function makeMockConnection(result: unknown = [[], []]) {
  return {
    query: jest.fn().mockImplementation(
      (_sql: unknown, _vals: unknown, cb: (err: null, res: unknown, fields: unknown) => void) => {
        cb(null, result, []);
      }
    ),
    execute: jest.fn().mockImplementation(
      (_sql: unknown, _vals: unknown, cb: (err: null, res: unknown, fields: unknown) => void) => {
        cb(null, result, []);
      }
    ),
  };
}

function makeMockPromiseConnection(result: unknown = [[], []]) {
  return {
    query: jest.fn().mockResolvedValue(result),
    execute: jest.fn().mockResolvedValue(result),
  };
}

const config: Config = { privacy: 'safe', threshold: 500 };

describe('patchMysql', () => {
  it('emits QueryEvent after callback-style query', (done) => {
    const conn = makeMockConnection();
    const events: QueryEvent[] = [];

    patchMysql(conn, config, (e) => events.push(e));
    conn.query("SELECT * FROM users WHERE email = 'jan@firma.pl'", [], (err: unknown, _res: unknown, _fields: unknown) => {
      expect(err).toBeNull();
      expect(events).toHaveLength(1);
      const event = events[0];
      expect(event.database).toBe('mysql');
      expect(event.sql).toBe("SELECT * FROM users WHERE email = 'jan@firma.pl'");
      expect(event.sanitizedSql).toBe('SELECT * FROM users WHERE email = ?');
      expect(event.durationMs).toBeGreaterThanOrEqual(0);
      expect(event.timestamp).toBeInstanceOf(Date);
      done();
    });
  });

  it('emits QueryEvent after callback-style execute', (done) => {
    const conn = makeMockConnection();
    const events: QueryEvent[] = [];

    patchMysql(conn, config, (e) => events.push(e));
    conn.execute('SELECT * FROM orders WHERE id = ?', [42], (err: unknown, _res: unknown, _fields: unknown) => {
      expect(err).toBeNull();
      expect(events).toHaveLength(1);
      expect(events[0].params).toEqual([42]);
      done();
    });
  });

  it('emits QueryEvent after promise-style query', async () => {
    const conn = makeMockPromiseConnection();
    const events: QueryEvent[] = [];

    patchMysql(conn, config, (e) => events.push(e));
    await conn.query('SELECT 1');

    expect(events).toHaveLength(1);
    expect(events[0].database).toBe('mysql');
  });

  it('emits QueryEvent after promise-style execute', async () => {
    const conn = makeMockPromiseConnection();
    const events: QueryEvent[] = [];

    patchMysql(conn, config, (e) => events.push(e));
    await conn.execute('SELECT * FROM products WHERE price > ?', [9.99]);

    expect(events).toHaveLength(1);
    expect(events[0].params).toEqual([9.99]);
  });

  it('extracts sql from QueryOptions object ({ sql })', (done) => {
    const conn = makeMockConnection();
    const events: QueryEvent[] = [];

    patchMysql(conn, config, (e) => events.push(e));
    conn.query({ sql: 'SELECT ? AS val', values: [1] } as any, [], (err: unknown, _res: unknown, _fields: unknown) => {
      expect(err).toBeNull();
      expect(events[0].sql).toBe('SELECT ? AS val');
      done();
    });
  });

  it('applies paranoid privacy mode', (done) => {
    const conn = makeMockConnection();
    const events: QueryEvent[] = [];

    patchMysql(conn, { privacy: 'paranoid' }, (e) => events.push(e));
    conn.query("SELECT * FROM users WHERE email = 'jan@firma.pl'", [], (_err: unknown, _res: unknown, _fields: unknown) => {
      expect(events[0].sanitizedSql).toBe('SELECT * FROM [table] WHERE [col] = ?');
      done();
    });
  });

  it('emits event even when query fails (callback)', (done) => {
    const conn = {
      query: jest.fn().mockImplementation(
        (_sql: unknown, _vals: unknown, cb: (err: Error) => void) => cb(new Error('connection lost'))
      ),
      execute: jest.fn(),
    };
    const events: QueryEvent[] = [];

    patchMysql(conn, config, (e) => events.push(e));
    conn.query('SELECT 1', [], (err: unknown) => {
      expect(err).toBeInstanceOf(Error);
      expect(events).toHaveLength(1);
      done();
    });
  });

  it('emits event even when promise query rejects', async () => {
    const conn = {
      query: jest.fn().mockRejectedValue(new Error('timeout')),
      execute: jest.fn().mockResolvedValue([]),
    };
    const events: QueryEvent[] = [];

    patchMysql(conn, config, (e) => events.push(e));
    await expect(conn.query('SELECT 1')).rejects.toThrow('timeout');
    expect(events).toHaveLength(1);
  });

  it('does not crash the app when emit throws', (done) => {
    const conn = makeMockConnection();

    patchMysql(conn, config, () => { throw new Error('notifier failure'); });
    conn.query('SELECT 1', [], (err: unknown) => {
      expect(err).toBeNull();
      done();
    });
  });

  it('skips patching execute if not present on target', () => {
    const conn = { query: jest.fn().mockResolvedValue([]) };
    expect(() => patchMysql(conn, config, () => {})).not.toThrow();
  });
});
