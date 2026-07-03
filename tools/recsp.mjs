import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const dir = join(process.cwd(), 'dist');
const htmlPath = join(dir, 'index.html');
const html = readFileSync(htmlPath, 'utf8');
const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!matches.length) { console.error('no inline script'); process.exit(1); }
const sha = 'sha256-' + createHash('sha256').update(matches[0], 'utf8').digest('base64');
// Rebuild _headers with the new sha. Preserve the rest of the policy.
const headersPath = join(dir, '_headers');
let body = readFileSync(headersPath, 'utf8');
body = body.replace(/sha256-[A-Za-z0-9+/=]+/, sha);
writeFileSync(headersPath, body);
console.log('recsp: recomputed inline sha =', sha);
