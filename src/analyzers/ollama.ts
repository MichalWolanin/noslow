import { QueryEvent, Config, AnalyzerResult, IssueType } from '../types';
import { postJsonBody } from '../notifiers/http';

const DEFAULT_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.2';
const VALID_ISSUES = new Set<string>(['slow_query', 'n_plus_one', 'full_table_scan', 'missing_index']);

const SYSTEM = `You are a SQL performance expert. Analyze the SQL query and respond with ONLY a JSON object — no markdown, no prose:
{
  "issue": "slow_query" | "full_table_scan" | "missing_index" | "n_plus_one",
  "description": "concise description of the performance problem",
  "fix": "actionable SQL fix or recommendation",
  "estimatedImpact": "expected performance improvement"
}`;

export async function ollamaAnalyzer(event: QueryEvent, config: Config): Promise<AnalyzerResult | null> {
  const baseUrl = (config.ollamaUrl ?? DEFAULT_URL).replace(/\/$/, '');

  const prompt = [
    `Database: ${event.database}, Execution time: ${event.durationMs}ms (threshold: ${config.threshold ?? 500}ms)`,
    ...(event.endpoint ? [`Endpoint: ${event.endpoint}`] : []),
    '',
    'SQL query:',
    event.sanitizedSql,
  ].join('\n');

  try {
    const raw = await postJsonBody(`${baseUrl}/api/chat`, {
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ],
      stream: false,
      format: 'json',
    });

    const apiResponse = JSON.parse(raw) as {
      message?: { role: string; content: string };
    };

    const text = apiResponse.message?.content?.trim();
    if (!text) return null;

    const result = JSON.parse(text) as Record<string, unknown>;

    if (
      typeof result.issue !== 'string' ||
      !VALID_ISSUES.has(result.issue) ||
      typeof result.description !== 'string' ||
      typeof result.fix !== 'string' ||
      typeof result.estimatedImpact !== 'string'
    ) {
      return null;
    }

    return {
      issue: result.issue as IssueType,
      description: result.description,
      fix: result.fix,
      estimatedImpact: result.estimatedImpact,
    };
  } catch {
    return null;
  }
}
