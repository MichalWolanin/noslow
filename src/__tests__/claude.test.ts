import { claudeAnalyzer } from '../analyzers/claude';
import * as http from '../notifiers/http';
import { Config, QueryEvent } from '../types';

jest.mock('../notifiers/http', () => ({
  postJson: jest.fn(),
  postJsonBody: jest.fn(),
}));

const mockPostBody = http.postJsonBody as jest.MockedFunction<typeof http.postJsonBody>;

function makeEvent(overrides: Partial<QueryEvent> = {}): QueryEvent {
  return {
    sql: "SELECT * FROM users WHERE email = 'jan@firma.pl'",
    sanitizedSql: 'SELECT * FROM users WHERE email = ?',
    durationMs: 820,
    database: 'pg',
    timestamp: new Date(),
    endpoint: 'GET /api/users',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    threshold: 500,
    mode: 'cloud',
    anthropicKey: 'sk-ant-test',
    ...overrides,
  };
}

function anthropicResponse(text: string): string {
  return JSON.stringify({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
  });
}

const VALID_RESULT = {
  issue: 'missing_index' as const,
  description: 'Query scans all rows; no index on email column.',
  fix: 'CREATE INDEX idx_users_email ON users (email);',
  estimatedImpact: 'Reduces scan from O(n) to O(log n).',
};

describe('claudeAnalyzer', () => {
  beforeEach(() => mockPostBody.mockClear());

  it('returns null when anthropicKey is missing', async () => {
    const result = await claudeAnalyzer(makeEvent(), makeConfig({ anthropicKey: undefined }));
    expect(result).toBeNull();
    expect(mockPostBody).not.toHaveBeenCalled();
  });

  it('calls Anthropic API with correct URL and headers', async () => {
    mockPostBody.mockResolvedValueOnce(anthropicResponse(JSON.stringify(VALID_RESULT)));
    await claudeAnalyzer(makeEvent(), makeConfig());
    expect(mockPostBody).toHaveBeenCalledTimes(1);
    expect(mockPostBody.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
    expect(mockPostBody.mock.calls[0][2]).toMatchObject({
      'x-api-key': 'sk-ant-test',
      'anthropic-version': '2023-06-01',
    });
  });

  it('sends correct model in request body', async () => {
    mockPostBody.mockResolvedValueOnce(anthropicResponse(JSON.stringify(VALID_RESULT)));
    await claudeAnalyzer(makeEvent(), makeConfig());
    const body = mockPostBody.mock.calls[0][1] as { model: string };
    expect(body.model).toBe('claude-haiku-4-5');
  });

  it('sends sanitized SQL (not raw values) in the prompt', async () => {
    mockPostBody.mockResolvedValueOnce(anthropicResponse(JSON.stringify(VALID_RESULT)));
    await claudeAnalyzer(makeEvent(), makeConfig());
    const body = mockPostBody.mock.calls[0][1] as { messages: Array<{ content: string }> };
    const content = body.messages[0].content;
    expect(content).toContain('SELECT * FROM users WHERE email = ?');
    expect(content).not.toContain("jan@firma.pl");
  });

  it('includes endpoint in prompt when present', async () => {
    mockPostBody.mockResolvedValueOnce(anthropicResponse(JSON.stringify(VALID_RESULT)));
    await claudeAnalyzer(makeEvent({ endpoint: 'GET /api/users' }), makeConfig());
    const body = mockPostBody.mock.calls[0][1] as { messages: Array<{ content: string }> };
    expect(body.messages[0].content).toContain('GET /api/users');
  });

  it('omits endpoint from prompt when absent', async () => {
    mockPostBody.mockResolvedValueOnce(anthropicResponse(JSON.stringify(VALID_RESULT)));
    const event = makeEvent();
    delete event.endpoint;
    await claudeAnalyzer(event, makeConfig());
    const body = mockPostBody.mock.calls[0][1] as { messages: Array<{ content: string }> };
    expect(body.messages[0].content).not.toContain('Endpoint');
    expect(body.messages[0].content).not.toContain('undefined');
  });

  it('includes durationMs, database and threshold in prompt', async () => {
    mockPostBody.mockResolvedValueOnce(anthropicResponse(JSON.stringify(VALID_RESULT)));
    await claudeAnalyzer(makeEvent({ durationMs: 1234, database: 'mysql' }), makeConfig({ threshold: 300 }));
    const body = mockPostBody.mock.calls[0][1] as { messages: Array<{ content: string }> };
    const content = body.messages[0].content;
    expect(content).toContain('1234ms');
    expect(content).toContain('mysql');
    expect(content).toContain('300ms');
  });

  it('parses a valid AnalyzerResult from Claude response', async () => {
    mockPostBody.mockResolvedValueOnce(anthropicResponse(JSON.stringify(VALID_RESULT)));
    const result = await claudeAnalyzer(makeEvent(), makeConfig());
    expect(result).toEqual(VALID_RESULT);
  });

  it.each(['slow_query', 'n_plus_one', 'full_table_scan', 'missing_index'] as const)(
    'accepts %s as a valid issue type',
    async (issue) => {
      mockPostBody.mockResolvedValueOnce(
        anthropicResponse(JSON.stringify({ ...VALID_RESULT, issue }))
      );
      const result = await claudeAnalyzer(makeEvent(), makeConfig());
      expect(result?.issue).toBe(issue);
    }
  );

  it('returns null for an invalid issue type', async () => {
    mockPostBody.mockResolvedValueOnce(
      anthropicResponse(JSON.stringify({ ...VALID_RESULT, issue: 'bad_type' }))
    );
    const result = await claudeAnalyzer(makeEvent(), makeConfig());
    expect(result).toBeNull();
  });

  it('returns null when required fields are missing', async () => {
    mockPostBody.mockResolvedValueOnce(
      anthropicResponse(JSON.stringify({ issue: 'slow_query', description: 'Slow' }))
    );
    const result = await claudeAnalyzer(makeEvent(), makeConfig());
    expect(result).toBeNull();
  });

  it('returns null when Claude returns non-JSON prose', async () => {
    mockPostBody.mockResolvedValueOnce(anthropicResponse('Sorry, I cannot help with that.'));
    const result = await claudeAnalyzer(makeEvent(), makeConfig());
    expect(result).toBeNull();
  });

  it('returns null when API response has empty content array', async () => {
    mockPostBody.mockResolvedValueOnce(JSON.stringify({ content: [] }));
    const result = await claudeAnalyzer(makeEvent(), makeConfig());
    expect(result).toBeNull();
  });

  it('returns null when API response JSON is malformed', async () => {
    mockPostBody.mockResolvedValueOnce('not valid json at all }{');
    const result = await claudeAnalyzer(makeEvent(), makeConfig());
    expect(result).toBeNull();
  });

  it('returns null when the HTTP call fails', async () => {
    mockPostBody.mockRejectedValueOnce(new Error('Network error'));
    const result = await claudeAnalyzer(makeEvent(), makeConfig());
    expect(result).toBeNull();
  });

  it('returns null on a non-2xx HTTP status (error thrown by postJsonBody)', async () => {
    mockPostBody.mockRejectedValueOnce(new Error('HTTP 401: Unauthorized'));
    const result = await claudeAnalyzer(makeEvent(), makeConfig());
    expect(result).toBeNull();
  });
});
