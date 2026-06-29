import { Alert, IssueType } from '../types';

const R = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';

const ISSUE_META: Record<IssueType, { color: string; label: string }> = {
  n_plus_one:      { color: RED,    label: 'N+1 DETECTED' },
  slow_query:      { color: YELLOW, label: 'SLOW QUERY' },
  full_table_scan: { color: RED,    label: 'FULL TABLE SCAN' },
  missing_index:   { color: YELLOW, label: 'MISSING INDEX' },
};

function c(code: string): string {
  return process.stdout.isTTY && !process.env['NO_COLOR'] ? code : '';
}

export function consoleNotifier(alert: Alert): void {
  const { queryEvent: qe, result } = alert;
  const { color, label } = ISSUE_META[result.issue];
  const endpoint = qe.endpoint ? ` — ${qe.endpoint}` : '';

  const lines = [
    `${c(BOLD)}${c(color)}[noslow] ${label}${c(R)}${endpoint}`,
    `  ${c(DIM)}db:${c(R)}       ${qe.database.toUpperCase()}`,
    `  ${c(DIM)}time:${c(R)}     ${qe.durationMs}ms`,
    `  ${c(DIM)}query:${c(R)}    ${c(CYAN)}${qe.sanitizedSql}${c(R)}`,
    `  ${c(DIM)}problem:${c(R)}  ${result.description}`,
    `  ${c(DIM)}fix:${c(R)}      ${c(GREEN)}${result.fix}${c(R)}`,
    `  ${c(DIM)}impact:${c(R)}   ${result.estimatedImpact}`,
  ];

  console.log(lines.join('\n'));
}
