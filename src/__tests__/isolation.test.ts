import { sqlSentinel } from '../index';
import { consoleNotifier } from '../notifiers/console';
import { slackNotifier } from '../notifiers/slack';
import { discordNotifier } from '../notifiers/discord';
import { teamsNotifier } from '../notifiers/teams';
import { telegramNotifier } from '../notifiers/telegram';
import { claudeAnalyzer } from '../analyzers/claude';
import { ollamaAnalyzer } from '../analyzers/ollama';
import { RulesAnalyzer } from '../analyzers/rules';
import { AnalyzerResult } from '../types';

jest.mock('../notifiers/console', () => ({ consoleNotifier: jest.fn() }));
jest.mock('../notifiers/slack', () => ({ slackNotifier: jest.fn() }));
jest.mock('../notifiers/discord', () => ({ discordNotifier: jest.fn() }));
jest.mock('../notifiers/teams', () => ({ teamsNotifier: jest.fn() }));
jest.mock('../notifiers/telegram', () => ({ telegramNotifier: jest.fn() }));
jest.mock('../analyzers/claude', () => ({ claudeAnalyzer: jest.fn() }));
jest.mock('../analyzers/ollama', () => ({ ollamaAnalyzer: jest.fn() }));

const mockConsole  = consoleNotifier  as jest.MockedFunction<typeof consoleNotifier>;
const mockSlack    = slackNotifier    as jest.MockedFunction<typeof slackNotifier>;
const mockDiscord  = discordNotifier  as jest.MockedFunction<typeof discordNotifier>;
const mockTeams    = teamsNotifier    as jest.MockedFunction<typeof teamsNotifier>;
const mockTelegram = telegramNotifier as jest.MockedFunction<typeof telegramNotifier>;
const mockClaude   = claudeAnalyzer   as jest.MockedFunction<typeof claudeAnalyzer>;
const mockOllama   = ollamaAnalyzer   as jest.MockedFunction<typeof ollamaAnalyzer>;

// flush all microtasks + one setImmediate tick (dynamic imports settle here)
const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

const SCAN_SQL = 'SELECT * FROM products'; // always triggers full_table_scan

const OK_RESULT: AnalyzerResult = {
  issue: 'slow_query',
  description: 'slow',
  fix: 'add index',
  estimatedImpact: '10x faster',
};

beforeEach(() => {
  mockConsole.mockReset().mockReturnValue(undefined);
  mockSlack.mockReset().mockResolvedValue(undefined);
  mockDiscord.mockReset().mockResolvedValue(undefined);
  mockTeams.mockReset().mockResolvedValue(undefined);
  mockTelegram.mockReset().mockResolvedValue(undefined);
  mockClaude.mockReset();
  mockOllama.mockReset();
});

// ── 1. consoleNotifier crash must NOT block network notifiers ─────────────────
// This is the critical bug: before the fix, throwing in consoleNotifier() caused
// sendAlert() to throw before it reached the dynamic-import notifier calls.

describe('consoleNotifier crash isolation', () => {
  it('consoleNotifier throws → slack is still called', async () => {
    mockConsole.mockImplementation(() => { throw new Error('console crash'); });

    const sentinel = sqlSentinel({
      threshold: 9999,
      notifiers: { slack: 'https://hooks.slack.com/xxx' },
    });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    sentinel.wrapPg(pool);

    await pool.query(SCAN_SQL);
    await flush();

    expect(mockSlack).toHaveBeenCalledTimes(1);
  });

  it('consoleNotifier throws → discord is still called', async () => {
    mockConsole.mockImplementation(() => { throw new Error('console crash'); });

    const sentinel = sqlSentinel({
      threshold: 9999,
      notifiers: { discord: 'https://discord.com/api/webhooks/xxx' },
    });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    sentinel.wrapPg(pool);

    await pool.query(SCAN_SQL);
    await flush();

    expect(mockDiscord).toHaveBeenCalledTimes(1);
  });

  it('consoleNotifier throws → teams is still called', async () => {
    mockConsole.mockImplementation(() => { throw new Error('console crash'); });

    const sentinel = sqlSentinel({
      threshold: 9999,
      notifiers: { teams: 'https://outlook.office.com/webhook/xxx' },
    });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    sentinel.wrapPg(pool);

    await pool.query(SCAN_SQL);
    await flush();

    expect(mockTeams).toHaveBeenCalledTimes(1);
  });

  it('consoleNotifier throws → telegram is still called', async () => {
    mockConsole.mockImplementation(() => { throw new Error('console crash'); });

    const sentinel = sqlSentinel({
      threshold: 9999,
      notifiers: { telegram: { token: 'BOT123', chatId: '-100456' } },
    });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    sentinel.wrapPg(pool);

    await pool.query(SCAN_SQL);
    await flush();

    expect(mockTelegram).toHaveBeenCalledTimes(1);
  });

  it('consoleNotifier throws → pool.query still resolves with original result', async () => {
    mockConsole.mockImplementation(() => { throw new Error('console crash'); });

    const sentinel = sqlSentinel({ threshold: 9999 });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 7 }] }) };
    sentinel.wrapPg(pool);

    const result = await (pool as any).query(SCAN_SQL);
    expect(result).toEqual({ rows: [{ id: 7 }] });
  });

  it('consoleNotifier throws repeatedly → ALL four network notifiers called per alert', async () => {
    mockConsole.mockImplementation(() => { throw new Error('always crashes'); });

    const sentinel = sqlSentinel({
      threshold: 9999,
      notifiers: {
        slack:    'https://hooks.slack.com/xxx',
        discord:  'https://discord.com/api/webhooks/xxx',
        teams:    'https://outlook.office.com/webhook/xxx',
        telegram: { token: 'BOT', chatId: '-100' },
      },
    });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    sentinel.wrapPg(pool);

    await pool.query(SCAN_SQL);
    await flush();

    expect(mockSlack).toHaveBeenCalledTimes(1);
    expect(mockDiscord).toHaveBeenCalledTimes(1);
    expect(mockTeams).toHaveBeenCalledTimes(1);
    expect(mockTelegram).toHaveBeenCalledTimes(1);
  });
});

// ── 2. Network notifier crash must NOT affect other notifiers or pool.query ───

describe('network notifier crash isolation', () => {
  it('slackNotifier rejects → pool.query still resolves', async () => {
    mockSlack.mockRejectedValue(new Error('slack is down'));

    const sentinel = sqlSentinel({
      threshold: 9999,
      notifiers: { slack: 'https://hooks.slack.com/xxx' },
    });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 1 }] }) };
    sentinel.wrapPg(pool);

    const result = await (pool as any).query(SCAN_SQL);
    await flush();

    expect(result).toEqual({ rows: [{ id: 1 }] });
  });

  it('slackNotifier rejects → discord is still called independently', async () => {
    mockSlack.mockRejectedValue(new Error('slack is down'));

    const sentinel = sqlSentinel({
      threshold: 9999,
      notifiers: {
        slack:   'https://hooks.slack.com/xxx',
        discord: 'https://discord.com/api/webhooks/xxx',
      },
    });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    sentinel.wrapPg(pool);

    await pool.query(SCAN_SQL);
    await flush();

    expect(mockDiscord).toHaveBeenCalledTimes(1);
  });

  it('discordNotifier rejects → pool.query still resolves', async () => {
    mockDiscord.mockRejectedValue(new Error('discord is down'));

    const sentinel = sqlSentinel({
      threshold: 9999,
      notifiers: { discord: 'https://discord.com/api/webhooks/xxx' },
    });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    sentinel.wrapPg(pool);

    const result = await (pool as any).query(SCAN_SQL);
    await flush();
    expect(result).toEqual({ rows: [] });
  });

  it('teamsNotifier rejects → pool.query still resolves', async () => {
    mockTeams.mockRejectedValue(new Error('teams is down'));

    const sentinel = sqlSentinel({
      threshold: 9999,
      notifiers: { teams: 'https://outlook.office.com/webhook/xxx' },
    });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    sentinel.wrapPg(pool);

    const result = await (pool as any).query(SCAN_SQL);
    await flush();
    expect(result).toEqual({ rows: [] });
  });

  it('telegramNotifier rejects → pool.query still resolves', async () => {
    mockTelegram.mockRejectedValue(new Error('telegram is down'));

    const sentinel = sqlSentinel({
      threshold: 9999,
      notifiers: { telegram: { token: 'BOT', chatId: '-100' } },
    });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    sentinel.wrapPg(pool);

    const result = await (pool as any).query(SCAN_SQL);
    await flush();
    expect(result).toEqual({ rows: [] });
  });

  it('all four network notifiers reject → pool.query still resolves', async () => {
    mockSlack.mockRejectedValue(new Error('slack'));
    mockDiscord.mockRejectedValue(new Error('discord'));
    mockTeams.mockRejectedValue(new Error('teams'));
    mockTelegram.mockRejectedValue(new Error('telegram'));

    const sentinel = sqlSentinel({
      threshold: 9999,
      notifiers: {
        slack:    'https://hooks.slack.com/xxx',
        discord:  'https://discord.com/api/webhooks/xxx',
        teams:    'https://outlook.office.com/webhook/xxx',
        telegram: { token: 'BOT', chatId: '-100' },
      },
    });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ ok: true }] }) };
    sentinel.wrapPg(pool);

    const result = await (pool as any).query(SCAN_SQL);
    await flush();
    expect(result).toEqual({ rows: [{ ok: true }] });
  });

  it('network notifier rejects → no unhandled promise rejection leaks', async () => {
    const leaked: unknown[] = [];
    const handler = (r: unknown) => leaked.push(r);
    process.on('unhandledRejection', handler);

    mockSlack.mockRejectedValue(new Error('leak test'));

    const sentinel = sqlSentinel({
      threshold: 9999,
      notifiers: { slack: 'https://hooks.slack.com/xxx' },
    });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    sentinel.wrapPg(pool);

    await pool.query(SCAN_SQL);
    await flush();
    await new Promise(resolve => setTimeout(resolve, 20));

    process.off('unhandledRejection', handler);
    expect(leaked).toHaveLength(0);
  });
});

// ── 3. Analyzer crash must NOT affect pool.query ──────────────────────────────

describe('analyzer crash isolation', () => {
  it('claudeAnalyzer rejects → pool.query still resolves', async () => {
    mockClaude.mockRejectedValue(new Error('Anthropic API 500'));

    const sentinel = sqlSentinel({
      threshold: 0,
      mode: 'cloud',
      anthropicKey: 'test-key',
    });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 99 }] }) };
    sentinel.wrapPg(pool);

    const result = await (pool as any).query('SELECT id FROM t WHERE id = 1');
    await flush();

    expect(result).toEqual({ rows: [{ id: 99 }] });
    expect(mockConsole).not.toHaveBeenCalled();
  });

  it('claudeAnalyzer rejects → no unhandled promise rejection leaks', async () => {
    const leaked: unknown[] = [];
    const handler = (r: unknown) => leaked.push(r);
    process.on('unhandledRejection', handler);

    mockClaude.mockRejectedValue(new Error('API down'));

    const sentinel = sqlSentinel({ threshold: 0, mode: 'cloud', anthropicKey: 'key' });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    sentinel.wrapPg(pool);

    await pool.query('SELECT id FROM t WHERE id = 1');
    await flush();
    await new Promise(resolve => setTimeout(resolve, 20));

    process.off('unhandledRejection', handler);
    expect(leaked).toHaveLength(0);
  });

  it('ollamaAnalyzer rejects → pool.query still resolves', async () => {
    mockOllama.mockRejectedValue(new Error('ollama not running'));

    const sentinel = sqlSentinel({ threshold: 0, mode: 'local' });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 5 }] }) };
    sentinel.wrapPg(pool);

    const result = await (pool as any).query('SELECT id FROM t WHERE id = 1');
    await flush();

    expect(result).toEqual({ rows: [{ id: 5 }] });
    expect(mockConsole).not.toHaveBeenCalled();
  });

  it('ollamaAnalyzer rejects → no unhandled promise rejection leaks', async () => {
    const leaked: unknown[] = [];
    const handler = (r: unknown) => leaked.push(r);
    process.on('unhandledRejection', handler);

    mockOllama.mockRejectedValue(new Error('connection refused'));

    const sentinel = sqlSentinel({ threshold: 0, mode: 'local' });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    sentinel.wrapPg(pool);

    await pool.query('SELECT id FROM t WHERE id = 1');
    await flush();
    await new Promise(resolve => setTimeout(resolve, 20));

    process.off('unhandledRejection', handler);
    expect(leaked).toHaveLength(0);
  });

  it('rulesAnalyzer.analyze throws → pool.query still resolves', async () => {
    jest.spyOn(RulesAnalyzer.prototype, 'analyze').mockImplementation(() => {
      throw new Error('rules internal crash');
    });

    const sentinel = sqlSentinel({ threshold: 0 });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ safe: true }] }) };
    sentinel.wrapPg(pool);

    const result = await (pool as any).query(SCAN_SQL);
    expect(result).toEqual({ rows: [{ safe: true }] });

    jest.restoreAllMocks();
  });

  it('rulesAnalyzer.analyze throws → console is not called', async () => {
    jest.spyOn(RulesAnalyzer.prototype, 'analyze').mockImplementation(() => {
      throw new Error('rules internal crash');
    });

    const sentinel = sqlSentinel({ threshold: 0 });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    sentinel.wrapPg(pool);

    await pool.query(SCAN_SQL);
    expect(mockConsole).not.toHaveBeenCalled();

    jest.restoreAllMocks();
  });
});

// ── 4. Middleware crash isolation ─────────────────────────────────────────────

describe('middleware crash isolation', () => {
  it('pg: original query rejects → rejection propagates to caller (correct), emit still fires', async () => {
    // Middleware must not swallow DB errors — they belong to the caller.
    // Verify emit still runs even when the query itself fails.
    const emitSpy = jest.fn();
    const pool = { query: jest.fn().mockRejectedValue(new Error('DB connection lost')) };
    const { patchPg } = await import('../middleware/pg');
    patchPg(pool, { threshold: 0 }, emitSpy);

    await expect((pool as any).query(SCAN_SQL)).rejects.toThrow('DB connection lost');
    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('mysql: original query rejects → rejection propagates to caller, emit still fires', async () => {
    const emitSpy = jest.fn();
    const conn = {
      query: jest.fn().mockRejectedValue(new Error('DB gone')),
      execute: jest.fn().mockResolvedValue([[], []]),
    };
    const { patchMysql } = await import('../middleware/mysql');
    patchMysql(conn, { threshold: 0 }, emitSpy);

    await expect((conn as any).query(SCAN_SQL)).rejects.toThrow('DB gone');
    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('pg callback: original signals error → callback receives it, emit still fires', (done) => {
    const emitSpy = jest.fn();
    const dbErr = new Error('timeout');
    const pool = {
      query: jest.fn((_sql: string, cb: (err: Error, r: unknown) => void) => {
        setImmediate(() => cb(dbErr, null));
      }),
    };

    import('../middleware/pg').then(({ patchPg }) => {
      patchPg(pool, { threshold: 0 }, emitSpy);

      (pool as any).query(SCAN_SQL, (err: Error) => {
        expect(err).toBe(dbErr);
        expect(emitSpy).toHaveBeenCalledTimes(1);
        done();
      });
    });
  });
});
