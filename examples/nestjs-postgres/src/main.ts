/**
 * NestJS integration example.
 *
 * Real app bootstrap — requires @nestjs/core, @nestjs/common, pg to be installed.
 * For a runnable demo without a database, use: npm run demo
 */

// import { NestFactory } from '@nestjs/core';
// import { AppModule } from './app.module';
//
// async function bootstrap() {
//   const app = await NestFactory.create(AppModule);
//   await app.listen(3000);
//   console.log('App running on http://localhost:3000');
// }
//
// bootstrap();

// ── Minimal HTTP server alternative (no NestJS dependency) ───────────────────
import * as http from 'http';
import { Pool } from './database';

const server = http.createServer(async (req, res) => {
  const url = req.url ?? '/';

  try {
    if (url === '/users') {
      // Triggers: full_table_scan
      await Pool.query('SELECT * FROM users');
      res.end(JSON.stringify({ message: 'users fetched — check console for alert' }));

    } else if (url.startsWith('/users/') && url.includes('/orders')) {
      // Triggers: n_plus_one if called in a loop
      const id = url.split('/')[2];
      await Pool.query('SELECT * FROM orders WHERE user_id = $1', [id]);
      res.end(JSON.stringify({ message: `orders for user ${id} fetched` }));

    } else if (url === '/slow') {
      // Triggers: slow_query / missing_index
      await Pool.query("SELECT * FROM users WHERE email = $1", ['test@example.com']);
      res.end(JSON.stringify({ message: 'slow query executed — check console for alert' }));

    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ routes: ['/users', '/users/:id/orders', '/slow'] }));
    }
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: String(err) }));
  }
});

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
  console.log('Try: curl http://localhost:3000/users');
});
