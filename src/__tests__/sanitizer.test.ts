import { sanitizeSql } from '../privacy/sanitizer';

describe('sanitizeSql - safe mode', () => {
  it('replaces single-quoted string literals', () => {
    const sql = "SELECT * FROM users WHERE email = 'jan@firma.pl'";
    expect(sanitizeSql(sql, 'safe')).toBe('SELECT * FROM users WHERE email = ?');
  });

  it('replaces numeric literals', () => {
    const sql = 'SELECT * FROM users WHERE age > 30';
    expect(sanitizeSql(sql, 'safe')).toBe('SELECT * FROM users WHERE age > ?');
  });

  it('replaces multiple values', () => {
    const sql = "SELECT * FROM users WHERE email = 'jan@firma.pl' AND age > 30";
    expect(sanitizeSql(sql, 'safe')).toBe('SELECT * FROM users WHERE email = ? AND age > ?');
  });

  it('replaces values in IN clause', () => {
    const sql = 'SELECT * FROM orders WHERE id IN (1, 2, 3)';
    expect(sanitizeSql(sql, 'safe')).toBe('SELECT * FROM orders WHERE id IN (?, ?, ?)');
  });

  it('replaces float values', () => {
    const sql = 'SELECT * FROM products WHERE price > 9.99';
    expect(sanitizeSql(sql, 'safe')).toBe('SELECT * FROM products WHERE price > ?');
  });

  it('replaces escaped quotes inside strings', () => {
    const sql = "SELECT * FROM users WHERE name = 'O\\'Brien'";
    expect(sanitizeSql(sql, 'safe')).toBe('SELECT * FROM users WHERE name = ?');
  });

  it('does not replace table or column names', () => {
    const sql = 'SELECT id, name FROM users WHERE active = 1';
    expect(sanitizeSql(sql, 'safe')).toBe('SELECT id, name FROM users WHERE active = ?');
  });
});

describe('sanitizeSql - paranoid mode', () => {
  it('replaces table names after FROM', () => {
    const sql = "SELECT * FROM users WHERE email = 'jan@firma.pl'";
    expect(sanitizeSql(sql, 'paranoid')).toBe('SELECT * FROM [table] WHERE [col] = ?');
  });

  it('replaces table names after JOIN', () => {
    const sql = 'SELECT * FROM users JOIN orders ON users.id = orders.user_id';
    const result = sanitizeSql(sql, 'paranoid');
    expect(result).toContain('FROM [table]');
    expect(result).toContain('JOIN [table]');
  });

  it('replaces table name after UPDATE', () => {
    const sql = "UPDATE users SET name = 'Jan' WHERE id = 5";
    const result = sanitizeSql(sql, 'paranoid');
    expect(result).toContain('UPDATE [table]');
  });

  it('replaces column names before comparison operators', () => {
    const sql = 'SELECT * FROM orders WHERE status = ? AND total > ?';
    const result = sanitizeSql(sql, 'paranoid');
    expect(result).toContain('[col] = ?');
    expect(result).toContain('[col] > ?');
  });

  it('replaces values AND table/column names', () => {
    const sql = "SELECT * FROM users WHERE email = 'jan@firma.pl' AND age > 30";
    const result = sanitizeSql(sql, 'paranoid');
    expect(result).toBe('SELECT * FROM [table] WHERE [col] = ? AND [col] > ?');
  });
});

describe('sanitizeSql - local mode', () => {
  it('still sanitizes string values', () => {
    const sql = "SELECT * FROM users WHERE email = 'jan@firma.pl'";
    expect(sanitizeSql(sql, 'local')).toBe('SELECT * FROM users WHERE email = ?');
  });

  it('still sanitizes numeric values', () => {
    const sql = 'SELECT * FROM users WHERE age > 30';
    expect(sanitizeSql(sql, 'local')).toBe('SELECT * FROM users WHERE age > ?');
  });

  it('does not replace table or column names', () => {
    const sql = 'SELECT * FROM users WHERE active = 1';
    expect(sanitizeSql(sql, 'local')).toBe('SELECT * FROM users WHERE active = ?');
  });
});
