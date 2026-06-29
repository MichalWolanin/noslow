import { buildTelegramText, telegramNotifier } from '../notifiers/telegram';
import * as http from '../notifiers/http';
import { Alert, TelegramConfig } from '../types';

jest.mock('../notifiers/http', () => ({ postJson: jest.fn().mockResolvedValue(undefined) }));
const mockPost = http.postJson as jest.MockedFunction<typeof http.postJson>;

const tgConfig: TelegramConfig = { token: 'BOT_TOKEN_123', chatId: '-100123456' };

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 'abc123',
    queryEvent: {
      sql: "SELECT * FROM orders WHERE user_id = 5",
      sanitizedSql: 'SELECT * FROM orders WHERE user_id = ?',
      durationMs: 42,
      database: 'mysql',
      timestamp: new Date(),
      endpoint: 'GET /api/orders',
    },
    result: {
      issue: 'n_plus_one',
      description: 'Same query executed 6 times within 1000ms — N+1 pattern detected.',
      fix: 'Replace repeated queries with a JOIN or use eager loading.',
      estimatedImpact: 'Reduces 6 round-trips to 1.',
    },
    ...overrides,
  };
}

describe('buildTelegramText', () => {
  it('starts with emoji and label', () => {
    const text = buildTelegramText(makeAlert());
    expect(text).toMatch(/^🔴/);
    expect(text).toContain('N+1 DETECTED');
  });

  it('uses correct emoji for each issue type', () => {
    expect(buildTelegramText(makeAlert({ result: { ...makeAlert().result, issue: 'n_plus_one' } }))).toMatch(/^🔴/);
    expect(buildTelegramText(makeAlert({ result: { ...makeAlert().result, issue: 'full_table_scan' } }))).toMatch(/^🔴/);
    expect(buildTelegramText(makeAlert({ result: { ...makeAlert().result, issue: 'slow_query' } }))).toMatch(/^🟡/);
    expect(buildTelegramText(makeAlert({ result: { ...makeAlert().result, issue: 'missing_index' } }))).toMatch(/^🟡/);
  });

  it('includes sanitized SQL in <pre> block (not raw)', () => {
    const text = buildTelegramText(makeAlert());
    expect(text).toContain('<pre>SELECT * FROM orders WHERE user_id = ?</pre>');
    expect(text).not.toContain('user_id = 5');
  });

  it('includes fix in <pre> block', () => {
    const text = buildTelegramText(makeAlert());
    expect(text).toContain('<pre>');
    expect(text).toContain('JOIN');
  });

  it('includes endpoint in <code> when present', () => {
    const text = buildTelegramText(makeAlert());
    expect(text).toContain('<code>GET /api/orders</code>');
  });

  it('omits endpoint when absent', () => {
    const alert = makeAlert();
    delete alert.queryEvent.endpoint;
    const text = buildTelegramText(alert);
    expect(text).not.toContain('Endpoint');
    expect(text).not.toContain('undefined');
  });

  it('escapes HTML special chars in SQL', () => {
    const alert = makeAlert({
      queryEvent: {
        ...makeAlert().queryEvent,
        sanitizedSql: 'SELECT * FROM t WHERE a > ? AND b < ?',
      },
    });
    const text = buildTelegramText(alert);
    expect(text).toContain('&gt;');
    expect(text).toContain('&lt;');
    expect(text).not.toContain('WHERE a > ?');
  });

  it('includes DB type and duration', () => {
    const text = buildTelegramText(makeAlert());
    expect(text).toContain('MYSQL');
    expect(text).toContain('42ms');
  });

  it('includes problem description and impact', () => {
    const text = buildTelegramText(makeAlert());
    expect(text).toContain('N+1 pattern detected');
    expect(text).toContain('Reduces 6 round-trips');
  });

  it('uses HTML bold tags for field labels', () => {
    const text = buildTelegramText(makeAlert());
    expect(text).toContain('<b>DB:</b>');
    expect(text).toContain('<b>Query:</b>');
    expect(text).toContain('<b>Fix:</b>');
  });

  it('escapes & to &amp; in endpoint query string', () => {
    const alert = makeAlert({
      queryEvent: {
        ...makeAlert().queryEvent,
        endpoint: 'GET /api/search?q=foo&limit=10',
      },
    });
    const text = buildTelegramText(alert);
    expect(text).toContain('&amp;');
    expect(text).not.toContain('q=foo&limit');
  });
});

describe('telegramNotifier', () => {
  beforeEach(() => mockPost.mockClear());

  it('calls postJson with the correct Bot API URL', async () => {
    await telegramNotifier(makeAlert(), tgConfig);
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost.mock.calls[0][0]).toBe(
      'https://api.telegram.org/botBOT_TOKEN_123/sendMessage'
    );
  });

  it('sends chat_id and parse_mode HTML', async () => {
    await telegramNotifier(makeAlert(), tgConfig);
    const body = mockPost.mock.calls[0][1] as { chat_id: string; parse_mode: string; text: string };
    expect(body.chat_id).toBe('-100123456');
    expect(body.parse_mode).toBe('HTML');
    expect(typeof body.text).toBe('string');
  });

  it('propagates errors from postJson', async () => {
    mockPost.mockRejectedValueOnce(new Error('forbidden'));
    await expect(telegramNotifier(makeAlert(), tgConfig)).rejects.toThrow('forbidden');
  });
});
