import { Alert, IssueType } from '../types';
import { postJson } from './http';

const EMOJI: Record<IssueType, string> = {
  n_plus_one:      ':red_circle:',
  slow_query:      ':large_yellow_circle:',
  full_table_scan: ':red_circle:',
  missing_index:   ':large_yellow_circle:',
};

const LABEL: Record<IssueType, string> = {
  n_plus_one:      'N+1 DETECTED',
  slow_query:      'SLOW QUERY',
  full_table_scan: 'FULL TABLE SCAN',
  missing_index:   'MISSING INDEX',
};

export function buildSlackPayload(alert: Alert): object {
  const { queryEvent: qe, result } = alert;
  const emoji = EMOJI[result.issue];
  const label = LABEL[result.issue];
  const endpoint = qe.endpoint ? ` — ${qe.endpoint}` : '';

  return {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${emoji.replace(/:.*:/, '⚠')} noslow — ${label}${endpoint}`,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*DB:* ${qe.database.toUpperCase()}` },
          { type: 'mrkdwn', text: `*Time:* ${qe.durationMs}ms` },
          ...(qe.endpoint
            ? [{ type: 'mrkdwn', text: `*Endpoint:* \`${qe.endpoint}\`` }]
            : []),
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Query:*\n\`\`\`${qe.sanitizedSql}\`\`\``,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Problem:* ${result.description}\n*Fix:*\n\`\`\`${result.fix}\`\`\``,
        },
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `${emoji} *Impact:* ${result.estimatedImpact}` },
        ],
      },
    ],
  };
}

export async function slackNotifier(alert: Alert, webhookUrl: string): Promise<void> {
  await postJson(webhookUrl, buildSlackPayload(alert));
}
