/**
 * Simulates a pg Pool with configurable latency.
 * Swap this for a real `new Pool({ connectionString })` in production.
 */
export function createMockPool(latencyMs = 0) {
  return {
    async query(sql: string, _params?: unknown[]) {
      if (latencyMs > 0) {
        await new Promise((r) => setTimeout(r, latencyMs));
      }
      return { rows: [], rowCount: 0 };
    },
  };
}
