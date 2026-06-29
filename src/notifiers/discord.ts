import { Alert, IssueType } from '../types';
import { postJson } from './http';

const COLOR: Record<IssueType, number> = {
  n_plus_one:      0xe74c3c, // red
  slow_query:      0xf39c12, // yellow
  full_table_scan: 0xe74c3c,
  missing_index:   0xf39c12,
};

const LABEL: Record<IssueType, string> = {
  n_plus_one:      'N+1 DETECTED',
  slow_query:      'SLOW QUERY',
  full_table_scan: 'FULL TABLE SCAN',
  missing_index:   'MISSING INDEX',
};

export function buildDiscordPayload(alert: Alert): object {
  const { queryEvent: qe, result } = alert;
  const label = LABEL[result.issue];
  const endpoint = qe.endpoint ? ` — ${qe.endpoint}` : '';

  const fields = [
    { name: 'DB',      value: qe.database.toUpperCase(), inline: true },
    { name: 'Time',    value: `${qe.durationMs}ms`,       inline: true },
    ...(qe.endpoint ? [{ name: 'Endpoint', value: `\`${qe.endpoint}\``, inline: true }] : []),
    { name: 'Query',   value: `\`\`\`sql\n${qe.sanitizedSql}\n\`\`\`` },
    { name: 'Problem', value: result.description },
    { name: 'Fix',     value: `\`\`\`sql\n${result.fix}\n\`\`\`` },
    { name: 'Impact',  value: result.estimatedImpact },
  ];

  return {
    username: 'noslow',
    embeds: [
      {
        title: `noslow — ${label}${endpoint}`,
        color: COLOR[result.issue],
        fields,
        footer: { text: 'noslow' },
        timestamp: qe.timestamp.toISOString(),
      },
    ],
  };
}

export async function discordNotifier(alert: Alert, webhookUrl: string): Promise<void> {
  await postJson(webhookUrl, buildDiscordPayload(alert));
}
