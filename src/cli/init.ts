#!/usr/bin/env node

import * as readline from 'readline';
import { writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import * as path from 'path';

// ── ANSI helpers ─────────────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY;
const b = (s: string) => (isTTY ? `\x1b[1m${s}\x1b[0m` : s);
const g = (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s);
const c = (s: string) => (isTTY ? `\x1b[36m${s}\x1b[0m` : s);
const d = (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s);

// ── Readline wrapper ──────────────────────────────────────────────────────────
function createRl() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

async function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function choose(
  rl: readline.Interface,
  question: string,
  options: string[],
  defaultIdx = 0
): Promise<number> {
  console.log(`\n${b(question)}`);
  options.forEach((opt, i) => console.log(`  ${d(String(i + 1) + ')')} ${opt}`));
  while (true) {
    const raw = (await ask(rl, `${d('>')} `)).trim();
    if (raw === '') return defaultIdx;
    const n = parseInt(raw);
    if (n >= 1 && n <= options.length) return n - 1;
    console.log(`  Please enter a number between 1 and ${options.length}`);
  }
}

async function multiSelect(
  rl: readline.Interface,
  question: string,
  options: string[],
  required: number[] = []
): Promise<number[]> {
  console.log(`\n${b(question)} ${d('(comma-separated numbers)')}`);
  options.forEach((opt, i) => {
    const req = required.includes(i) ? d(' [always on]') : '';
    console.log(`  ${d(String(i + 1) + ')')} ${opt}${req}`);
  });
  while (true) {
    const raw = (await ask(rl, `${d('>')} `)).trim();
    if (raw === '') return [...required];
    const chosen = raw
      .split(',')
      .map((s) => parseInt(s.trim()) - 1)
      .filter((n) => !isNaN(n) && n >= 0 && n < options.length);
    return [...new Set([...required, ...chosen])];
  }
}

// ── Config generation (pure — testable) ──────────────────────────────────────
export interface SentinelRc {
  threshold: number;
  mode: 'rules' | 'cloud' | 'local';
  privacy: 'safe' | 'paranoid' | 'local';
  databases: ('pg' | 'mysql')[];
  notifiers: {
    console: boolean;
    slack?: boolean;
    discord?: boolean;
    teams?: boolean;
    telegram?: boolean;
  };
}

export function buildCodeSnippet(rc: SentinelRc): string {
  const imports = [
    `import { sqlSentinel } from 'noslow'`,
    ...rc.databases.map((db) => `// import { pool } from './your-${db}-pool'`),
  ].join('\n');

  const notifierLines: string[] = [`    console: true`];
  if (rc.notifiers.slack)    notifierLines.push(`    slack: process.env.SLACK_WEBHOOK`);
  if (rc.notifiers.discord)  notifierLines.push(`    discord: process.env.DISCORD_WEBHOOK`);
  if (rc.notifiers.teams)    notifierLines.push(`    teams: process.env.TEAMS_WEBHOOK`);
  if (rc.notifiers.telegram) notifierLines.push(`    telegram: { token: process.env.TELEGRAM_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID }`);

  const modeExtras = rc.mode === 'cloud' ? `\n  anthropicKey: process.env.ANTHROPIC_KEY,` : '';

  return `${imports}

const sentinel = sqlSentinel({
  threshold: ${rc.threshold},
  mode: '${rc.mode}',
  privacy: '${rc.privacy}',${modeExtras}
  notifiers: {
${notifierLines.join(',\n')}
  },
})

${rc.databases.map((db) => `sentinel.wrap${db === 'pg' ? 'Pg' : 'Mysql'}(pool)`).join('\n')}
`;
}

// ── Package installer ─────────────────────────────────────────────────────────
function detectPackageManager(): 'npm' | 'yarn' | 'pnpm' {
  if (existsSync(path.join(process.cwd(), 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(process.cwd(), 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function installPackages(pkgs: string[]): void {
  if (pkgs.length === 0) return;
  const pm = detectPackageManager();
  const cmd = pm === 'npm' ? `npm install ${pkgs.join(' ')}` : `${pm} add ${pkgs.join(' ')}`;
  console.log(`\n${d('$')} ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: process.cwd() });
}

function missingDeps(dbs: ('pg' | 'mysql')[]): string[] {
  const missing: string[] = [];
  for (const db of dbs) {
    const pkg = db === 'pg' ? 'pg' : 'mysql2';
    try {
      require.resolve(pkg);
    } catch {
      missing.push(pkg);
    }
  }
  return missing;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(`\n${b('noslow')} — Interactive Setup\n${'─'.repeat(36)}`);

  const rl = createRl();

  try {
    // 1. Database
    const dbIdx = await choose(rl, 'Which database(s) are you using?', [
      'PostgreSQL',
      'MySQL',
      'Both',
    ]);
    const databases: ('pg' | 'mysql')[] =
      dbIdx === 0 ? ['pg'] : dbIdx === 1 ? ['mysql'] : ['pg', 'mysql'];

    // 2. Analysis mode
    const modeIdx = await choose(rl, 'Analysis mode:', [
      'rules   — zero dependencies, built-in detection (recommended)',
      'cloud   — Claude Haiku API (set ANTHROPIC_KEY)',
      'local   — Ollama (local LLM, no internet)',
    ]);
    const mode = (['rules', 'cloud', 'local'] as const)[modeIdx];

    // 3. Notifiers
    const notifierOptions = ['Console', 'Slack', 'Discord', 'Microsoft Teams', 'Telegram'];
    const selectedNotifiers = await multiSelect(
      rl,
      'Which notifiers to enable?',
      notifierOptions,
      [0] // console is always on
    );
    const notifiers = {
      console: true,
      slack:    selectedNotifiers.includes(1),
      discord:  selectedNotifiers.includes(2),
      teams:    selectedNotifiers.includes(3),
      telegram: selectedNotifiers.includes(4),
    };

    // 4. Threshold
    console.log(`\n${b('Alert threshold in ms')} ${d('[500]')}`);
    const thresholdRaw = (await ask(rl, `${d('>')} `)).trim();
    const threshold = thresholdRaw === '' ? 500 : Math.max(1, parseInt(thresholdRaw) || 500);

    // 5. Privacy mode
    const privacyIdx = await choose(rl, 'Privacy mode:', [
      'safe      — replace values with ? (recommended)',
      'paranoid  — also hide table and column names',
      'local     — no network connections, console only',
    ]);
    const privacy = (['safe', 'paranoid', 'local'] as const)[privacyIdx];

    rl.close();

    // Generate .sentinelrc.json
    const rc: SentinelRc = { threshold, mode, privacy, databases, notifiers };
    const rcPath = path.join(process.cwd(), '.sentinelrc.json');
    writeFileSync(rcPath, JSON.stringify(rc, null, 2) + '\n');
    console.log(`\n${g('✓')} Generated ${b('.sentinelrc.json')}`);

    // Install missing peer deps
    const toInstall = missingDeps(databases);
    if (toInstall.length > 0) {
      console.log(`\nInstalling missing peer dependencies: ${toInstall.join(', ')}`);
      installPackages(toInstall);
      console.log(g('✓') + ' Installed');
    }

    // Code snippet
    console.log(`\n${b('Add this to your app:')}\n`);
    console.log(c(buildCodeSnippet(rc)));

    if (notifiers.slack || notifiers.discord || notifiers.teams) {
      console.log(d('Set the corresponding *_WEBHOOK env vars before starting your app.\n'));
    }
    if (notifiers.telegram) {
      console.log(d('Set TELEGRAM_TOKEN and TELEGRAM_CHAT_ID env vars before starting your app.\n'));
    }
    if (mode === 'cloud') {
      console.log(d('Set ANTHROPIC_KEY env var before starting your app.\n'));
    }
  } catch (err) {
    rl.close();
    throw err;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
