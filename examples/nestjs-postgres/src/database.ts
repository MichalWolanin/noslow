/**
 * Database setup: create a pg Pool and wrap it with noslow.
 *
 * In a real app replace createMockPool() with:
 *   import { Pool } from 'pg'
 *   const pool = new Pool({ connectionString: process.env.DATABASE_URL })
 */

import { sqlSentinel } from 'noslow';
import { createMockPool } from './mock-pool';

const pool = createMockPool();

const sentinel = sqlSentinel({
  threshold: Number(process.env.SENTINEL_THRESHOLD ?? 500),
  mode: 'rules',
  privacy: 'safe',
  notifiers: {
    console: true,
    slack: process.env.SLACK_WEBHOOK,
    discord: process.env.DISCORD_WEBHOOK,
  },
});

sentinel.wrapPg(pool);

export { pool as Pool };
