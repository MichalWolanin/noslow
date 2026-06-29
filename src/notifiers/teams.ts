import { Alert, IssueType } from '../types';
import { postJson } from './http';

const THEME_COLOR: Record<IssueType, string> = {
  n_plus_one:      'E74C3C', // red
  slow_query:      'F39C12', // yellow
  full_table_scan: 'E74C3C',
  missing_index:   'F39C12',
};

const LABEL: Record<IssueType, string> = {
  n_plus_one:      'N+1 DETECTED',
  slow_query:      'SLOW QUERY',
  full_table_scan: 'FULL TABLE SCAN',
  missing_index:   'MISSING INDEX',
};

export function buildTeamsPayload(alert: Alert): object {
  const { queryEvent: qe, result } = alert;
  const label = LABEL[result.issue];
  const endpoint = qe.endpoint ? ` — ${qe.endpoint}` : '';

  const facts = [
    { name: 'DB',    value: qe.database.toUpperCase() },
    { name: 'Time',  value: `${qe.durationMs}ms` },
    ...(qe.endpoint ? [{ name: 'Endpoint', value: qe.endpoint }] : []),
    { name: 'Query', value: qe.sanitizedSql },
  ];

  return {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    summary: `noslow — ${label}`,
    themeColor: THEME_COLOR[result.issue],
    title: `noslow — ${label}${endpoint}`,
    sections: [
      { facts },
      { title: '⚠ Problem', text: result.description },
      { title: '🔧 Fix',    text: `<pre>${result.fix}</pre>` },
      { title: '📈 Impact', text: result.estimatedImpact },
    ],
  };
}

export async function teamsNotifier(alert: Alert, webhookUrl: string): Promise<void> {
  await postJson(webhookUrl, buildTeamsPayload(alert));
}
