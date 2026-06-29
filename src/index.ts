import { createHash } from 'crypto';
import { Config, QueryEvent, Alert, AnalyzerResult } from './types';
import { patchPg } from './middleware/pg';
import { patchMysql } from './middleware/mysql';
import { RulesAnalyzer } from './analyzers/rules';
import { claudeAnalyzer } from './analyzers/claude';
import { ollamaAnalyzer } from './analyzers/ollama';
import { consoleNotifier } from './notifiers/console';

export type { Config, Alert, QueryEvent, AnalyzerResult, PrivacyMode, AnalysisMode } from './types';

function alertId(issue: string, sanitizedSql: string): string {
  return createHash('sha1').update(`${issue}:${sanitizedSql}`).digest('hex').slice(0, 16);
}

// Upper bound on rate-limit entries to prevent unbounded memory growth in long-running apps.
const MAX_RATE_LIMIT_ENTRIES = 10_000;

export function sqlSentinel(config: Config = {}) {
  const rulesAnalyzer = new RulesAnalyzer();
  // Reject NaN / negative — NaN disables rate-limiting silently (NaN < NaN is false).
  const rawRl = Number(config.rateLimit ?? 300);
  const rateLimitMs = (rawRl >= 0 ? rawRl : 300) * 1000;
  const lastAlerted = new Map<string, number>();
  const isLocalPrivacy = config.privacy === 'local';

  const notifiers = config.notifiers ?? {};
  const useConsole = notifiers.console !== false; // default on

  const sendAlert = (event: QueryEvent, result: AnalyzerResult): void => {
    const id = alertId(result.issue, event.sanitizedSql);
    const now = Date.now();
    // Check against lastAlerted only when the entry exists — using ?? 0 would make
    // `now - 0 < Infinity` always true and silently block every first-ever alert.
    const lastTime = lastAlerted.get(id);
    if (lastTime !== undefined && now - lastTime < rateLimitMs) return;
    // Evict all entries when cap is reached to prevent unbounded growth.
    if (lastAlerted.size >= MAX_RATE_LIMIT_ENTRIES) lastAlerted.clear();
    lastAlerted.set(id, now);

    const alert: Alert = { queryEvent: event, result, id };

    if (useConsole) {
      try { consoleNotifier(alert); } catch { /* never crash */ }
    }

    // Each network notifier is isolated — a crash in one never affects the others.
    // Skipped entirely in local privacy mode.
    if (!isLocalPrivacy) {
      if (notifiers.slack) {
        (async () => {
          try {
            const { slackNotifier } = await import('./notifiers/slack');
            await slackNotifier(alert, notifiers.slack!);
          } catch { /* never crash */ }
        })();
      }
      if (notifiers.discord) {
        (async () => {
          try {
            const { discordNotifier } = await import('./notifiers/discord');
            await discordNotifier(alert, notifiers.discord!);
          } catch { /* never crash */ }
        })();
      }
      if (notifiers.teams) {
        (async () => {
          try {
            const { teamsNotifier } = await import('./notifiers/teams');
            await teamsNotifier(alert, notifiers.teams!);
          } catch { /* never crash */ }
        })();
      }
      if (notifiers.telegram) {
        (async () => {
          try {
            const { telegramNotifier } = await import('./notifiers/telegram');
            await telegramNotifier(alert, notifiers.telegram!);
          } catch { /* never crash */ }
        })();
      }
    }
  };

  const emit = (event: QueryEvent): void => {
    if (config.mode === 'cloud' && config.anthropicKey && !isLocalPrivacy) {
      (async () => {
        try {
          const result = await claudeAnalyzer(event, config);
          if (result) sendAlert(event, result);
        } catch { /* never crash */ }
      })();
    } else if (config.mode === 'local') {
      (async () => {
        try {
          const result = await ollamaAnalyzer(event, config);
          if (result) sendAlert(event, result);
        } catch { /* never crash */ }
      })();
    } else {
      try {
        const result = rulesAnalyzer.analyze(event, config);
        if (result) sendAlert(event, result);
      } catch { /* never crash */ }
    }
  };

  return {
    wrapPg(target: unknown): void {
      patchPg(target, config, emit);
    },
    wrapMysql(target: unknown): void {
      patchMysql(target, config, emit);
    },
  };
}
