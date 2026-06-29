import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

function buildRequest(
  webhookUrl: string,
  body: unknown,
  extraHeaders: Record<string, string | number> = {}
): { mod: typeof https | typeof http; options: object; data: string } {
  const url = new URL(webhookUrl); // throws TypeError for malformed URLs
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TypeError(`Webhook URL must use http:// or https:// — got: ${url.protocol}`);
  }
  const data = JSON.stringify(body);
  const mod = url.protocol === 'https:' ? https : http;
  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      'User-Agent': 'noslow/1.0',
      ...extraHeaders,
    },
  };
  return { mod, options, data };
}

export function postJson(webhookUrl: string, body: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const { mod, options, data } = buildRequest(webhookUrl, body);
    const req = mod.request(options, (res) => {
      res.resume();
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        resolve();
      } else {
        reject(new Error(`HTTP ${res.statusCode}`));
      }
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

export function postJsonBody(
  webhookUrl: string,
  body: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const { mod, options, data } = buildRequest(webhookUrl, body, extraHeaders);
    const req = mod.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(text);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${text}`));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
