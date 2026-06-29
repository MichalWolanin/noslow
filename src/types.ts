export type PrivacyMode = 'safe' | 'paranoid' | 'local';

export type AnalysisMode = 'rules' | 'cloud' | 'local';

export type DatabaseType = 'pg' | 'mysql';

export interface TelegramConfig {
  token: string;
  chatId: string;
}

export interface NotifiersConfig {
  console?: boolean;
  slack?: string;
  discord?: string;
  teams?: string;
  telegram?: TelegramConfig;
}

export interface Config {
  threshold?: number;       // ms, default 500
  mode?: AnalysisMode;      // default 'rules'
  privacy?: PrivacyMode;    // default 'safe'
  anthropicKey?: string;
  ollamaUrl?: string;       // default 'http://localhost:11434'
  notifiers?: NotifiersConfig;
  rateLimit?: number;       // seconds between same alert, default 300
}

export interface QueryEvent {
  sql: string;
  sanitizedSql: string;
  durationMs: number;
  database: DatabaseType;
  timestamp: Date;
  endpoint?: string;        // HTTP route if available
  params?: unknown[];
}

export type IssueType =
  | 'slow_query'
  | 'n_plus_one'
  | 'full_table_scan'
  | 'missing_index';

export interface AnalyzerResult {
  issue: IssueType;
  description: string;
  fix: string;
  estimatedImpact: string;
}

export interface Alert {
  queryEvent: QueryEvent;
  result: AnalyzerResult;
  id: string;              // hash used for rate limiting deduplication
}
