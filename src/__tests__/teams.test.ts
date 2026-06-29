import { buildTeamsPayload, teamsNotifier } from '../notifiers/teams';
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
      durationMs: 710,
      database: 'pg',
      timestamp: new Date(),
      endpoint: 'GET /api/users',
    },
    result: {
      issue: 'slow_query',
      description: 'Query took 710ms — exceeds 500ms threshold.',
      fix: 'Run EXPLAIN ANALYZE to inspect the query plan.',
      estimatedImpact: 'Depends on query complexity.',
    },
    ...overrides,
  };
}

describe('buildTeamsPayload', () => {
  it('returns @type MessageCard', () => {
    const payload = buildTeamsPayload(makeAlert()) as { '@type': string };
    expect(payload['@type']).toBe('MessageCard');
  });

  it('title contains issue label', () => {
    const payload = buildTeamsPayload(makeAlert()) as { title: string };
    expect(payload.title).toContain('SLOW QUERY');
  });

  it('title includes endpoint when present', () => {
    const payload = buildTeamsPayload(makeAlert()) as { title: string };
    expect(payload.title).toContain('GET /api/users');
  });

  it('title omits endpoint when absent', () => {
    const alert = makeAlert();
    delete alert.queryEvent.endpoint;
    const payload = buildTeamsPayload(alert) as { title: string };
    expect(payload.title).not.toContain('GET /api/users');
    expect(payload.title).not.toContain('undefined');
  });

  it('uses red themeColor for n_plus_one', () => {
    const payload = buildTeamsPayload(
      makeAlert({ result: { ...makeAlert().result, issue: 'n_plus_one' } })
    ) as { themeColor: string };
    expect(payload.themeColor).toBe('E74C3C');
  });

  it('uses red themeColor for full_table_scan', () => {
    const payload = buildTeamsPayload(
      makeAlert({ result: { ...makeAlert().result, issue: 'full_table_scan' } })
    ) as { themeColor: string };
    expect(payload.themeColor).toBe('E74C3C');
  });

  it('uses yellow themeColor for slow_query', () => {
    const payload = buildTeamsPayload(makeAlert()) as { themeColor: string };
    expect(payload.themeColor).toBe('F39C12');
  });

  it('uses yellow themeColor for missing_index', () => {
    const payload = buildTeamsPayload(
      makeAlert({ result: { ...makeAlert().result, issue: 'missing_index' } })
    ) as { themeColor: string };
    expect(payload.themeColor).toBe('F39C12');
  });

  it('facts include DB, Time and Query', () => {
    const payload = buildTeamsPayload(makeAlert()) as {
      sections: Array<{ facts?: Array<{ name: string; value: string }> }>;
    };
    const facts = payload.sections[0].facts ?? [];
    expect(facts.find((f) => f.name === 'DB')?.value).toBe('PG');
    expect(facts.find((f) => f.name === 'Time')?.value).toBe('710ms');
    expect(facts.find((f) => f.name === 'Query')?.value).toBe('SELECT * FROM users WHERE email = ?');
  });

  it('facts include Endpoint when present', () => {
    const payload = buildTeamsPayload(makeAlert()) as {
      sections: Array<{ facts?: Array<{ name: string; value: string }> }>;
    };
    const facts = payload.sections[0].facts ?? [];
    expect(facts.find((f) => f.name === 'Endpoint')?.value).toBe('GET /api/users');
  });

  it('facts omit Endpoint when absent', () => {
    const alert = makeAlert();
    delete alert.queryEvent.endpoint;
    const payload = buildTeamsPayload(alert) as {
      sections: Array<{ facts?: Array<{ name: string; value: string }> }>;
    };
    const facts = payload.sections[0].facts ?? [];
    expect(facts.find((f) => f.name === 'Endpoint')).toBeUndefined();
  });

  it('sections contain Problem, Fix and Impact', () => {
    const payload = buildTeamsPayload(makeAlert()) as {
      sections: Array<{ title?: string; text?: string }>;
    };
    const titles = payload.sections.map((s) => s.title ?? '');
    expect(titles.some((t) => t.includes('Problem'))).toBe(true);
    expect(titles.some((t) => t.includes('Fix'))).toBe(true);
    expect(titles.some((t) => t.includes('Impact'))).toBe(true);
  });

  it('sanitized SQL in facts — not raw values', () => {
    const json = JSON.stringify(buildTeamsPayload(makeAlert()));
    expect(json).toContain('email = ?');
    expect(json).not.toContain("jan@firma.pl");
  });

  it('summary field contains issue label', () => {
    const payload = buildTeamsPayload(makeAlert()) as { summary: string };
    expect(payload.summary).toContain('SLOW QUERY');
  });

  it('Problem section text contains result.description', () => {
    const payload = buildTeamsPayload(makeAlert()) as {
      sections: Array<{ title?: string; text?: string }>;
    };
    const problem = payload.sections.find((s) => s.title?.includes('Problem'));
    expect(problem?.text).toContain('exceeds 500ms threshold');
  });

  it('Fix section text wraps result.fix in <pre> tags', () => {
    const payload = buildTeamsPayload(makeAlert()) as {
      sections: Array<{ title?: string; text?: string }>;
    };
    const fix = payload.sections.find((s) => s.title?.includes('Fix'));
    expect(fix?.text).toBe('<pre>Run EXPLAIN ANALYZE to inspect the query plan.</pre>');
  });

  it('Impact section text contains result.estimatedImpact', () => {
    const payload = buildTeamsPayload(makeAlert()) as {
      sections: Array<{ title?: string; text?: string }>;
    };
    const impact = payload.sections.find((s) => s.title?.includes('Impact'));
    expect(impact?.text).toContain('Depends on query complexity');
  });
});

describe('teamsNotifier', () => {
  beforeEach(() => mockPost.mockClear());

  it('calls postJson with the webhook URL', async () => {
    await teamsNotifier(makeAlert(), 'https://company.webhook.office.com/test');
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost.mock.calls[0][0]).toBe('https://company.webhook.office.com/test');
  });

  it('passes a MessageCard payload', async () => {
    await teamsNotifier(makeAlert(), 'https://company.webhook.office.com/test');
    const payload = mockPost.mock.calls[0][1] as { '@type': string };
    expect(payload['@type']).toBe('MessageCard');
  });

  it('propagates errors from postJson', async () => {
    mockPost.mockRejectedValueOnce(new Error('timeout'));
    await expect(
      teamsNotifier(makeAlert(), 'https://company.webhook.office.com/test')
    ).rejects.toThrow('timeout');
  });
});
