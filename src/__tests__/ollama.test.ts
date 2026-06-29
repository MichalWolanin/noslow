import { ollamaAnalyzer } from '../analyzers/ollama';
import * as http from '../notifiers/http';
import { Config, QueryEvent } from '../types';

jest.mock('../notifiers/http', () => ({
  postJson: jest.fn(),
  postJsonBody: jest.fn(),
}));

const mockPostBody = http.postJsonBody as jest.MockedFunction<typeof http.postJsonBody>;

function makeEvent(overrides: Partial<QueryEvent> = {}): QueryEvent {
  return {
    sql: 'SELECT * FROM orders WHERE user_id = 42',
    sanitizedSql: 'SELECT * FROM orders WHERE user_id = ?',
    durationMs: 600,
    database: 'pg',
    timestamp: new Date(),
    endpoint: 'GET /api/orders',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    threshold: 500,
    mode: 'local',
    ...overrides,
  };
}

function ollamaResponse(content: string): string {
  return JSON.stringify({
    model: 'llama3.2',
    message: { role: 'assistant', content },
    done: true,
  });
}

const VALID_RESULT = {
  issue: 'slow_query' as const,
  description: 'Query took 600ms — exceeds 500ms threshold.',
  fix: 'Run EXPLAIN ANALYZE to inspect the query plan.',
  estimatedImpact: 'Depends on query complexity and indexes.',
};

describe('ollamaAnalyzer', () => {
  beforeEach(() => mockPostBody.mockClear());

  it('calls the Ollama chat endpoint at default URL', async () => {
    mockPostBody.mockResolvedValueOnce(ollamaResponse(JSON.stringify(VALID_RESULT)));
    await ollamaAnalyzer(makeEvent(), makeConfig());
    expect(mockPostBody.mock.calls[0][0]).toBe('http://localhost:11434/api/chat');
  });

  it('uses a custom ollamaUrl when provided', async () => {
    mockPostBody.mockResolvedValueOnce(ollamaResponse(JSON.stringify(VALID_RESULT)));
    await ollamaAnalyzer(makeEvent(), makeConfig({ ollamaUrl: 'http://my-server:11434' }));
    expect(mockPostBody.mock.calls[0][0]).toBe('http://my-server:11434/api/chat');
  });

  it('strips trailing slash from ollamaUrl', async () => {
    mockPostBody.mockResolvedValueOnce(ollamaResponse(JSON.stringify(VALID_RESULT)));
    await ollamaAnalyzer(makeEvent(), makeConfig({ ollamaUrl: 'http://localhost:11434/' }));
    expect(mockPostBody.mock.calls[0][0]).toBe('http://localhost:11434/api/chat');
  });

  it('sends stream: false and format: json', async () => {
    mockPostBody.mockResolvedValueOnce(ollamaResponse(JSON.stringify(VALID_RESULT)));
    await ollamaAnalyzer(makeEvent(), makeConfig());
    const body = mockPostBody.mock.calls[0][1] as { stream: boolean; format: string };
    expect(body.stream).toBe(false);
    expect(body.format).toBe('json');
  });

  it('includes a system message with JSON schema instruction', async () => {
    mockPostBody.mockResolvedValueOnce(ollamaResponse(JSON.stringify(VALID_RESULT)));
    await ollamaAnalyzer(makeEvent(), makeConfig());
    const body = mockPostBody.mock.calls[0][1] as {
      messages: Array<{ role: string; content: string }>;
    };
    const sys = body.messages.find(m => m.role === 'system');
    expect(sys).toBeDefined();
    expect(sys!.content).toContain('JSON');
  });

  it('sends sanitized SQL (not raw values) in the user message', async () => {
    mockPostBody.mockResolvedValueOnce(ollamaResponse(JSON.stringify(VALID_RESULT)));
    await ollamaAnalyzer(makeEvent(), makeConfig());
    const body = mockPostBody.mock.calls[0][1] as {
      messages: Array<{ role: string; content: string }>;
    };
    const user = body.messages.find(m => m.role === 'user');
    expect(user!.content).toContain('SELECT * FROM orders WHERE user_id = ?');
    expect(user!.content).not.toContain('user_id = 42');
  });

  it('includes endpoint in the user message when present', async () => {
    mockPostBody.mockResolvedValueOnce(ollamaResponse(JSON.stringify(VALID_RESULT)));
    await ollamaAnalyzer(makeEvent({ endpoint: 'GET /api/orders' }), makeConfig());
    const body = mockPostBody.mock.calls[0][1] as {
      messages: Array<{ role: string; content: string }>;
    };
    const user = body.messages.find(m => m.role === 'user');
    expect(user!.content).toContain('GET /api/orders');
  });

  it('omits endpoint from the user message when absent', async () => {
    mockPostBody.mockResolvedValueOnce(ollamaResponse(JSON.stringify(VALID_RESULT)));
    const event = makeEvent();
    delete event.endpoint;
    await ollamaAnalyzer(event, makeConfig());
    const body = mockPostBody.mock.calls[0][1] as {
      messages: Array<{ role: string; content: string }>;
    };
    const user = body.messages.find(m => m.role === 'user');
    expect(user!.content).not.toContain('Endpoint');
    expect(user!.content).not.toContain('undefined');
  });

  it('includes durationMs, database and threshold in the prompt', async () => {
    mockPostBody.mockResolvedValueOnce(ollamaResponse(JSON.stringify(VALID_RESULT)));
    await ollamaAnalyzer(makeEvent({ durationMs: 999, database: 'mysql' }), makeConfig({ threshold: 200 }));
    const body = mockPostBody.mock.calls[0][1] as {
      messages: Array<{ role: string; content: string }>;
    };
    const user = body.messages.find(m => m.role === 'user');
    expect(user!.content).toContain('999ms');
    expect(user!.content).toContain('mysql');
    expect(user!.content).toContain('200ms');
  });

  it('does not send auth headers (no credentials for local Ollama)', async () => {
    mockPostBody.mockResolvedValueOnce(ollamaResponse(JSON.stringify(VALID_RESULT)));
    await ollamaAnalyzer(makeEvent(), makeConfig());
    const extraHeaders = mockPostBody.mock.calls[0][2];
    expect(extraHeaders).toBeUndefined();
  });

  it('parses a valid AnalyzerResult from Ollama response', async () => {
    mockPostBody.mockResolvedValueOnce(ollamaResponse(JSON.stringify(VALID_RESULT)));
    const result = await ollamaAnalyzer(makeEvent(), makeConfig());
    expect(result).toEqual(VALID_RESULT);
  });

  it.each(['slow_query', 'n_plus_one', 'full_table_scan', 'missing_index'] as const)(
    'accepts %s as a valid issue type',
    async (issue) => {
      mockPostBody.mockResolvedValueOnce(
        ollamaResponse(JSON.stringify({ ...VALID_RESULT, issue }))
      );
      const result = await ollamaAnalyzer(makeEvent(), makeConfig());
      expect(result?.issue).toBe(issue);
    }
  );

  it('returns null for an invalid issue type', async () => {
    mockPostBody.mockResolvedValueOnce(
      ollamaResponse(JSON.stringify({ ...VALID_RESULT, issue: 'bad_type' }))
    );
    const result = await ollamaAnalyzer(makeEvent(), makeConfig());
    expect(result).toBeNull();
  });

  it('returns null when required fields are missing', async () => {
    mockPostBody.mockResolvedValueOnce(
      ollamaResponse(JSON.stringify({ issue: 'slow_query', description: 'Slow' }))
    );
    const result = await ollamaAnalyzer(makeEvent(), makeConfig());
    expect(result).toBeNull();
  });

  it('returns null when the model returns non-JSON prose', async () => {
    mockPostBody.mockResolvedValueOnce(ollamaResponse('I cannot analyze this query.'));
    const result = await ollamaAnalyzer(makeEvent(), makeConfig());
    expect(result).toBeNull();
  });

  it('returns null when API response has no message field', async () => {
    mockPostBody.mockResolvedValueOnce(JSON.stringify({ done: true }));
    const result = await ollamaAnalyzer(makeEvent(), makeConfig());
    expect(result).toBeNull();
  });

  it('returns null when the HTTP call fails (Ollama not running)', async () => {
    mockPostBody.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await ollamaAnalyzer(makeEvent(), makeConfig());
    expect(result).toBeNull();
  });

  it('returns null when the outer response JSON is malformed', async () => {
    mockPostBody.mockResolvedValueOnce('not json {{');
    const result = await ollamaAnalyzer(makeEvent(), makeConfig());
    expect(result).toBeNull();
  });
});
