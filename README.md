# noslow

[![npm](https://img.shields.io/npm/v/noslow)](https://www.npmjs.com/package/noslow)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-244%20passing-brightgreen)](https://github.com/michalwolanin/noslow)

Middleware that sits between your app and the database, measures every SQL query, and sends an alert with a ready-to-use fix when it detects a problem.

<!-- GIF DEMO PLACEHOLDER -->

---

## Install

```bash
npm install noslow
```

Or run the interactive setup wizard — it installs only what you need:

```bash
npx noslow init
```

---

## Quick Start

```ts
import { sqlSentinel } from 'noslow'
import { pool } from './db'

const sentinel = sqlSentinel()
sentinel.wrapPg(pool)
```

That's it. Alerts appear in the console. No config required.

**Example console output:**

```
[noslow] MISSING INDEX — GET /api/users
  db:       PG
  time:     847ms
  query:    SELECT * FROM users WHERE email = ?
  problem:  Query took 847ms — possible missing index on: email.
  fix:      CREATE INDEX idx_email ON <table> (email);
  impact:   Index lookup reduces O(n) scan to O(log n) — typically 10-1000× faster.

[noslow] N+1 DETECTED — POST /api/orders
  db:       PG
  time:     12ms
  query:    SELECT * FROM products WHERE id = ?
  problem:  Same query executed 7 times within 1000ms — N+1 pattern detected.
  fix:      Replace repeated queries with a JOIN or use eager loading.
  impact:   Reduces 7 round-trips to 1 — up to 7× fewer database calls.
```

---

## How It Works

```
pool.query(sql)
      │
      ▼
  [middleware]  ← wraps pg / mysql2 — zero changes to your query code
      │
      ├── sanitizer    strips all values before anything is logged or sent
      │
      ├── analyzer     detects: slow query · N+1 · full table scan · missing index
      │
      └── notifiers    console · Slack · Discord · Teams · Telegram
```

Every alert contains:
- endpoint where the query ran (if available)
- execution time in ms
- **sanitized** SQL (values replaced with `?`)
- detected problem
- ready-to-paste SQL fix
- estimated performance impact

---

## Privacy & Security

**No data ever leaves your server without your explicit configuration.**

- The sanitizer runs before every log entry and every outgoing message — this is enforced in code, not just policy.
- Raw SQL values (`jan@company.com`, `42`, `'secret'`) are never stored, logged, or transmitted.
- Network notifiers (Slack, Discord, etc.) are only initialized if you configure a webhook URL.
- `mode: 'local'` disables all outbound connections — console output only.
- `privacy: 'local'` additionally blocks all network notifiers even if webhooks are configured.

### Three privacy modes

| Mode | What gets sanitized | Network calls |
|---|---|---|
| `safe` *(default)* | Values replaced with `?` | Only configured notifiers |
| `paranoid` | Values + table/column names hidden | Only configured notifiers |
| `local` | Values replaced with `?` | None — console only |

### What gets sent to Slack/Discord/etc.

```
-- original query (never sent):
SELECT * FROM users WHERE email = 'jan@company.com' AND age > 30

-- what notifiers receive:
SELECT * FROM users WHERE email = ? AND age > ?
```

---

## Analysis Modes

| Mode | How it works | Dependencies |
|---|---|---|
| `rules` *(default)* | Built-in heuristics — detects N+1, full table scans, slow queries, missing indexes | None |
| `cloud` | Sends sanitized SQL to Claude Haiku API for intelligent analysis | `ANTHROPIC_KEY` env var |
| `local` | Same as cloud but runs a local Ollama model — zero internet | Ollama running locally |

> **`cloud` + `privacy: 'local'` fallback** — if you set `mode: 'cloud'` and `privacy: 'local'` at the same time, the cloud analyzer is automatically skipped (it would require a network call, which `local` privacy forbids). noslow falls back to `rules` mode silently. No error is thrown.

### What `rules` mode detects

| Issue | Detection logic |
|---|---|
| **slow_query** | Execution time ≥ threshold (default 500 ms) |
| **n_plus_one** | Same query executed > 5 times within 1 000 ms |
| **full_table_scan** | `SELECT` without `WHERE` clause |
| **missing_index** | Slow query with columns in `WHERE` — suggests `CREATE INDEX` |

---

## Notifiers

| Notifier | Config key | Default |
|---|---|---|
| Console | `notifiers.console` | `true` |
| Slack | `notifiers.slack` | webhook URL string |
| Discord | `notifiers.discord` | webhook URL string |
| Microsoft Teams | `notifiers.teams` | webhook URL string |
| Telegram | `notifiers.telegram` | `{ token, chatId }` |

All network notifiers are fire-and-forget — a delivery failure never affects your application.

---

## Configuration

```ts
import { sqlSentinel } from 'noslow'

const sentinel = sqlSentinel({
  // Alert threshold in milliseconds. Queries slower than this trigger an alert.
  threshold: 500,

  // Analysis engine: 'rules' | 'cloud' | 'local'
  mode: 'rules',

  // Privacy level: 'safe' | 'paranoid' | 'local'
  privacy: 'safe',

  // Required when mode: 'cloud'
  anthropicKey: process.env.ANTHROPIC_KEY,

  // Required when mode: 'local' (defaults to http://localhost:11434)
  ollamaUrl: 'http://localhost:11434',

  // Minimum seconds between identical alerts. 0 = no throttle, default = 300 (5 min)
  rateLimit: 300,

  notifiers: {
    console: true,
    slack:    process.env.SLACK_WEBHOOK,
    discord:  process.env.DISCORD_WEBHOOK,
    teams:    process.env.TEAMS_WEBHOOK,
    telegram: {
      token:  process.env.TELEGRAM_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID,
    },
  },
})

// PostgreSQL (pg)
sentinel.wrapPg(pool)

// MySQL (mysql2)
sentinel.wrapMysql(connection)
```

### Minimum config — rules mode, console only

```ts
sqlSentinel()
```

### Cloud analysis via Claude Haiku

```ts
sqlSentinel({
  mode: 'cloud',
  anthropicKey: process.env.ANTHROPIC_KEY,
})
```

### Local analysis via Ollama, paranoid privacy, Slack alerts

```ts
sqlSentinel({
  mode: 'local',
  privacy: 'paranoid',
  notifiers: {
    slack: process.env.SLACK_WEBHOOK,
  },
})
```

---

## Supported Databases

| Database | Driver | Wrapper |
|---|---|---|
| PostgreSQL | `pg` ≥ 8 | `sentinel.wrapPg(pool)` |
| MySQL | `mysql2` ≥ 3 | `sentinel.wrapMysql(connection)` |

Both promise-style and callback-style APIs are supported.

---

## Requirements

- Node.js ≥ 18
- `pg` ≥ 8 and/or `mysql2` ≥ 3 (peer dependencies, only install what you use)

---

## License

MIT © 2026 Michal Wolanin
