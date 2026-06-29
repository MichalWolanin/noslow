import { QueryEvent, Config, AnalyzerResult, IssueType } from '../types';
import { postJsonBody } from '../notifiers/http';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';
const VALID_ISSUES = new Set<string>(['slow_query', 'n_plus_one', 'full_table_scan', 'missing_index']);

const SYSTEM = `You are a SQL performance expert. Analyze the SQL query and respond with ONLY a JSON object — no markdown, no prose:
{
  "issue": "slow_query" | "full_table_scan" | "missing_index" | "n_plus_one",
  "description": "concise description of the performance problem",
  "fix": "actionable SQL fix or recommendation",
  "estimatedImpact": "expected performance improvement"
}`;

export async function claudeAnalyzer(event: QueryEvent, config: Config): Promise<AnalyzerResult | null> {
  // Trim so a whitespace-only key ("   ") doesn't reach the API and produce a 401.
  if (!config.anthropicKey?.trim()) return null;

  const prompt = [
    `Database: ${event.database}, Execution time: ${event.durationMs}ms (threshold: ${config.threshold ?? 500}ms)`,
    ...(event.endpoint ? [`Endpoint: ${event.endpoint}`] : []),
    '',
    'SQL query:',
    event.sanitizedSql,
  ].join('\n');

  try {
    const raw = await postJsonBody(
      ANTHROPIC_API,
      {
        model: MODEL,
        max_tokens: 512,
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        'x-api-key': config.anthropicKey,
        'anthropic-version': '2023-06-01',
      }
    );

    const apiResponse = JSON.parse(raw) as {
      content?: Array<{ type: string; text: string }>;
    };

    const text = apiResponse.content?.find(b => b.type === 'text')?.text?.trim();
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
