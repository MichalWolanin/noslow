import { buildSlackPayload, slackNotifier } from '../notifiers/slack';
import * as http from '../notifiers/http';
import { Alert } from '../types';

jest.mock('../notifiers/http', () => ({ postJson: jest.fn().mockResolvedValue(undefined) }));
const mockPost = http.postJson as jest.MockedFunction<typeof http.postJson>;

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 'abc123',
    queryEvent: {
      sql: "SELECT * FROM orders WHERE user_id = 5",
      sanitizedSql: 'SELECT * FROM orders WHERE user_id = ?',
      durationMs: 820,
      database: 'pg',
      timestamp: new Date(),
      endpoint: 'GET /api/orders',
    },
    result: {
      issue: 'missing_index',
      description: 'Query took 820ms — possible missing index on: user_id.',
      fix: 'CREATE INDEX idx_user_id ON orders (user_id);',
      estimatedImpact: 'Index lookup reduces O(n) scan to O(log n).',
    },
    ...overrides,
  };
}

describe('buildSlackPayload', () => {
  it('returns a blocks array', () => {
    const payload = buildSlackPayload(makeAlert()) as { blocks: unknown[] };
    expect(Array.isArray(payload.blocks)).toBe(true);
    expect((payload.blocks as unknown[]).length).toBeGreaterThan(0);
  });

  it('header block contains issue label', () => {
    const payload = buildSlackPayload(makeAlert()) as { blocks: Array<{ type: string; text?: { text: string } }> };
    const header = payload.blocks.find((b) => b.type === 'header');
    expect(header?.text?.text).toContain('MISSING INDEX');
  });

  it('includes sanitized SQL (not raw)', () => {
    const json = JSON.stringify(buildSlackPayload(makeAlert()));
    expect(json).toContain('user_id = ?');
    expect(json).not.toContain('user_id = 5');
  });

  it('includes fix SQL', () => {
    const json = JSON.stringify(buildSlackPayload(makeAlert()));
    expect(json).toContain('CREATE INDEX idx_user_id');
  });

  it('includes endpoint when present', () => {
    const json = JSON.stringify(buildSlackPayload(makeAlert()));
    expect(json).toContain('GET /api/orders');
  });

  it('omits endpoint field when absent', () => {
    const alert = makeAlert();
    delete alert.queryEvent.endpoint;
    const payload = buildSlackPayload(alert) as { blocks: Array<{ type: string; fields?: Array<{ text: string }> }> };
    const section = payload.blocks.find((b) => b.type === 'section' && b.fields);
    const hasEndpointField = section?.fields?.some((f) => f.text.includes('Endpoint'));
    expect(hasEndpointField).toBeFalsy();
  });

  it('sets correct label for each issue type', () => {
    const cases: Array<[Alert['result']['issue'], string]> = [
      ['n_plus_one', 'N+1 DETECTED'],
      ['slow_query', 'SLOW QUERY'],
      ['full_table_scan', 'FULL TABLE SCAN'],
      ['missing_index', 'MISSING INDEX'],
    ];
    for (const [issue, label] of cases) {
      const payload = buildSlackPayload(makeAlert({ result: { ...makeAlert().result, issue } })) as {
        blocks: Array<{ type: string; text?: { text: string } }>;
      };
      const header = payload.blocks.find((b) => b.type === 'header');
      expect(header?.text?.text).toContain(label);
    }
  });

  it('includes durationMs in the fields section', () => {
    const json = JSON.stringify(buildSlackPayload(makeAlert()));
    expect(json).toContain('820ms');
  });
});

describe('slackNotifier', () => {
  beforeEach(() => mockPost.mockClear());

  it('calls postJson with the webhook URL', async () => {
    await slackNotifier(makeAlert(), 'https://hooks.slack.com/test');
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost.mock.calls[0][0]).toBe('https://hooks.slack.com/test');
  });

  it('passes a valid Slack payload', async () => {
    await slackNotifier(makeAlert(), 'https://hooks.slack.com/test');
    const payload = mockPost.mock.calls[0][1] as { blocks: unknown[] };
    expect(payload.blocks).toBeDefined();
  });

  it('propagates errors from postJson', async () => {
    mockPost.mockRejectedValueOnce(new Error('network error'));
    await expect(slackNotifier(makeAlert(), 'https://hooks.slack.com/test')).rejects.toThrow(
      'network error'
    );
  });
});
