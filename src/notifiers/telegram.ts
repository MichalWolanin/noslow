import { Alert, IssueType, TelegramConfig } from '../types';
import { postJson } from './http';

const EMOJI: Record<IssueType, string> = {
  n_plus_one:      '🔴',
  slow_query:      '🟡',
  full_table_scan: '🔴',
  missing_index:   '🟡',
};

const LABEL: Record<IssueType, string> = {
  n_plus_one:      'N+1 DETECTED',
  slow_query:      'SLOW QUERY',
  full_table_scan: 'FULL TABLE SCAN',
  missing_index:   'MISSING INDEX',
};

function esc(text: string): string {
  // Escape HTML special chars for Telegram HTML parse mode
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildTelegramText(alert: Alert): string {
  const { queryEvent: qe, result } = alert;
  const emoji = EMOJI[result.issue];
  const label = LABEL[result.issue];
  const endpoint = qe.endpoint ? `\n<b>Endpoint:</b> <code>${esc(qe.endpoint)}</code>` : '';

  return [
    `${emoji} <b>noslow — ${esc(label)}</b>`,
    '',
    `<b>DB:</b> ${qe.database.toUpperCase()}`,
    `<b>Time:</b> ${qe.durationMs}ms${endpoint}`,
    '',
    `<b>Query:</b>\n<pre>${esc(qe.sanitizedSql)}</pre>`,
    `<b>Problem:</b> ${esc(result.description)}`,
    '',
    `<b>Fix:</b>\n<pre>${esc(result.fix)}</pre>`,
    `<b>Impact:</b> ${esc(result.estimatedImpact)}`,
  ].join('\n');
}

export async function telegramNotifier(alert: Alert, config: TelegramConfig): Promise<void> {
  const url = `https://api.telegram.org/bot${config.token}/sendMessage`;
  await postJson(url, {
    chat_id: config.chatId,
    text: buildTelegramText(alert),
    parse_mode: 'HTML',
  });
}
