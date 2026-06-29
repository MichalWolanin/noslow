import { buildDiscordPayload, discordNotifier } from '../notifiers/discord';
import * as http from '../notifiers/http';
import { Alert } from '../types';

jest.mock('../notifiers/http', () => ({ postJson: jest.fn().mockResolvedValue(undefined) }));
const mockPost = http.postJson as jest.MockedFunction<typeof http.postJson>;

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 'abc123',
    queryEvent: {
      sql: "SELECT * FROM users WHERE email = 'jan@firma.pl'",
      sanitizedSql: 'SELECT * FROM users WHERE email = ?',
      durationMs: 650,
      database: 'mysql',
      timestamp: new Date('2024-06-01T12:00:00Z'),
      endpoint: 'POST /api/login',
    },
    result: {
      issue: 'missing_index',
      description: 'Query took 650ms — possible missing index on: email.',
      fix: 'CREATE INDEX idx_email ON users (email);',
      estimatedImpact: 'Index lookup reduces O(n) scan to O(log n).',
    },
    ...overrides,
  };
}

describe('buildDiscordPayload', () => {
  it('returns username and embeds array', () => {
    const payload = buildDiscordPayload(makeAlert()) as { username: string; embeds: unknown[] };
    expect(payload.username).toBe('noslow');
    expect(Array.isArray(payload.embeds)).toBe(true);
    expect(payload.embeds).toHaveLength(1);
  });

  it('embed title contains issue label', () => {
    const payload = buildDiscordPayload(makeAlert()) as { embeds: Array<{ title: string }> };
    expect(payload.embeds[0].title).toContain('MISSING INDEX');
  });

  it('embed title includes endpoint when present', () => {
    const payload = buildDiscordPayload(makeAlert()) as { embeds: Array<{ title: string }> };
    expect(payload.embeds[0].title).toContain('POST /api/login');
  });

  it('embed title omits endpoint when absent', () => {
    const alert = makeAlert();
    delete alert.queryEvent.endpoint;
    const payload = buildDiscordPayload(alert) as { embeds: Array<{ title: string }> };
    expect(payload.embeds[0].title).not.toContain('undefined');
    expect(payload.embeds[0].title).not.toContain('POST /api/login');
  });

  it('uses red color for n_plus_one', () => {
    const payload = buildDiscordPayload(
      makeAlert({ result: { ...makeAlert().result, issue: 'n_plus_one' } })
    ) as { embeds: Array<{ color: number }> };
    expect(payload.embeds[0].color).toBe(0xe74c3c);
  });

  it('uses red color for full_table_scan', () => {
    const payload = buildDiscordPayload(
      makeAlert({ result: { ...makeAlert().result, issue: 'full_table_scan' } })
    ) as { embeds: Array<{ color: number }> };
    expect(payload.embeds[0].color).toBe(0xe74c3c);
  });

  it('uses yellow color for slow_query', () => {
    const payload = buildDiscordPayload(
      makeAlert({ result: { ...makeAlert().result, issue: 'slow_query' } })
    ) as { embeds: Array<{ color: number }> };
    expect(payload.embeds[0].color).toBe(0xf39c12);
  });

  it('includes sanitized SQL in query field (not raw)', () => {
    const json = JSON.stringify(buildDiscordPayload(makeAlert()));
    expect(json).toContain('email = ?');
    expect(json).not.toContain("jan@firma.pl");
  });

  it('includes fix and impact fields', () => {
    const json = JSON.stringify(buildDiscordPayload(makeAlert()));
    expect(json).toContain('CREATE INDEX idx_email');
    expect(json).toContain('O(log n)');
  });

  it('embed has ISO timestamp', () => {
    const payload = buildDiscordPayload(makeAlert()) as { embeds: Array<{ timestamp: string }> };
    expect(payload.embeds[0].timestamp).toBe('2024-06-01T12:00:00.000Z');
  });

  it('includes DB and time as inline fields', () => {
    const payload = buildDiscordPayload(makeAlert()) as {
      embeds: Array<{ fields: Array<{ name: string; value: string; inline?: boolean }> }>;
    };
    const fields = payload.embeds[0].fields;
    const db = fields.find((f) => f.name === 'DB');
    const time = fields.find((f) => f.name === 'Time');
    expect(db?.value).toBe('MYSQL');
    expect(db?.inline).toBe(true);
    expect(time?.value).toBe('650ms');
    expect(time?.inline).toBe(true);
  });
});

describe('discordNotifier', () => {
  beforeEach(() => mockPost.mockClear());

  it('calls postJson with the webhook URL', async () => {
    await discordNotifier(makeAlert(), 'https://discord.com/api/webhooks/test');
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost.mock.calls[0][0]).toBe('https://discord.com/api/webhooks/test');
  });

  it('passes a payload with embeds', async () => {
    await discordNotifier(makeAlert(), 'https://discord.com/api/webhooks/test');
    const payload = mockPost.mock.calls[0][1] as { embeds: unknown[] };
    expect(payload.embeds).toBeDefined();
  });

  it('propagates errors from postJson', async () => {
    mockPost.mockRejectedValueOnce(new Error('timeout'));
    await expect(
      discordNotifier(makeAlert(), 'https://discord.com/api/webhooks/test')
    ).rejects.toThrow('timeout');
  });
});
