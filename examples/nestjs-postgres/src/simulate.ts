/**
 * Simulation of common SQL problems detected by noslow.
 * Run with: npm run demo
 *
 * No real database needed — uses a mock pool with artificial latency.
 */

import { sqlSentinel } from 'noslow';
import { createMockPool } from './mock-pool';

const separator = () => console.log('\n' + '─'.repeat(60) + '\n');

async function runScenario(
  title: string,
  fn: (pool: ReturnType<typeof createMockPool>) => Promise<void>,
  latencyMs = 0,
  threshold = 9999
) {
  separator();
  console.log(`SCENARIO: ${title}`);

  const pool = createMockPool(latencyMs);
  const sentinel = sqlSentinel({
    threshold,
    privacy: 'safe',
    rateLimit: 0, // disable rate limit so every alert fires in the demo
    notifiers: { console: true },
  });
  sentinel.wrapPg(pool);

  await fn(pool);
}

async function main() {
  console.log('\nnoslow — Live Demo\n');

  // ── Scenario 1: N+1 ─────────────────────────────────────────────────────────
  await runScenario(
    'N+1 — loading each user\'s orders individually',
    async (pool) => {
      // Simulate: fetch 8 users, then load their orders one-by-one
      const userIds = [1, 2, 3, 4, 5, 6, 7, 8];
      for (const id of userIds) {
        await pool.query('SELECT * FROM orders WHERE user_id = $1', [id]);
      }
    }
  );

  // ── Scenario 2: Full table scan ──────────────────────────────────────────────
  await runScenario(
    'Full table scan — SELECT without WHERE',
    async (pool) => {
      await pool.query('SELECT * FROM users');
      await pool.query('SELECT id, email FROM products');
    }
  );

  // ── Scenario 3: Missing index ────────────────────────────────────────────────
  await runScenario(
    'Missing index — slow query on unindexed column',
    async (pool) => {
      await pool.query("SELECT * FROM users WHERE email = $1", ['admin@example.com']);
      await pool.query('SELECT * FROM orders WHERE status = $1 AND total > $2', ['pending', 100]);
    },
    620, // simulate 620ms latency
    500  // threshold 500ms
  );

  // ── Scenario 4: Slow query (no extractable index hint) ──────────────────────
  await runScenario(
    'Slow query — BETWEEN range scan',
    async (pool) => {
      await pool.query(
        'SELECT * FROM events WHERE created_at BETWEEN $1 AND $2',
        ['2024-01-01', '2024-12-31']
      );
    },
    800,
    500
  );

  separator();
  console.log('Demo complete.\n');
}

main().catch(console.error);
