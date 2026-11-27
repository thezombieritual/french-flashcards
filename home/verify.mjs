// Decrypt the published page and refuse plaintext menu data in the repo.
//
//   SITE_PASSWORD='…' node home/verify.mjs

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { b64ToBytes, decryptWithRawKey, deriveAesRaw, findPlaintext, secretStrings } from './vault.mjs';

const homeDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(homeDir);
const linksPath = process.env.LINKS_FILE || join(homeDir, 'links.json');
const password = process.env.SITE_PASSWORD;

if (!password) {
  console.error('Set SITE_PASSWORD in the environment.');
  process.exit(1);
}

const menu = JSON.parse(await readFile(linksPath, 'utf8'));
const html = await readFile(join(root, 'public/home/index.html'), 'utf8');
const vault = JSON.parse(html.match(/<script id="vault"[^>]*>([\s\S]*?)<\/script>/)[1]);
const raw = await deriveAesRaw(password, b64ToBytes(vault.salt), vault.iter);
assert.deepEqual(await decryptWithRawKey(vault, raw), menu);
await assert.rejects(() =>
  deriveAesRaw(`${password}!`, b64ToBytes(vault.salt), vault.iter).then((bad) => decryptWithRawKey(vault, bad)),
);

const ignored = execFileSync('git', ['check-ignore', linksPath], { cwd: root, encoding: 'utf8' });
assert.match(ignored, /links\.json/);
const trackedLinks = execFileSync('git', ['ls-files', '--', 'home/links.json'], { cwd: root, encoding: 'utf8' });
assert.equal(trackedLinks.trim(), '');

const secrets = secretStrings(menu);
const pageFiles = ['public/home/index.html', 'public/home/unlock.js', 'public/home/robots.txt', 'public/robots.txt', 'home/page.template.html'];
for (const rel of pageFiles) {
  const text = await readFile(join(root, rel), 'utf8');
  const hit = findPlaintext(text, secrets, password);
  if (hit) fail(`${rel} contains plaintext (${hit.kind})`);
}

const skipDir = new Set(['.git', 'node_modules', 'dist', 'playwright-report', 'test-results']);
const skipFile = new Set([
  'home/links.json',
  'home/vault.mjs',
  'home/build.mjs',
  'home/verify.mjs',
  'home/browser-check.mjs',
  'home/self-test.mjs',
]);
await walk(root, async (abs) => {
  const rel = relative(root, abs);
  if (skipFile.has(rel)) return;
  const text = await readFile(abs, 'utf8');
  if (text.includes(password)) fail(`${rel} contains the site password`);
  if (text.includes('grokbot://')) fail(`${rel} contains a grokbot URL`);
  for (const href of hrefs(menu)) {
    if (href.startsWith('grokbot:')) continue;
      if (href === 'https://thezombieritual.github.io/french-flashcards/') {
        if ((rel.startsWith('public/home/') || rel.startsWith('home/')) && text.includes(href)) {
          fail(`${rel} contains the French app URL in the home source`);
        }
        continue;
      }
    if (text.includes(href)) fail(`${rel} contains a private URL`);
  }
  for (const token of privateTokens(menu)) {
    if (text.includes(token)) fail(`${rel} contains a private id`);
  }
});

console.log(`verify ok (${menu.sections.reduce((n, section) => n + section.links.length, 0)} links).`);

function hrefs(value) {
  return value.sections.flatMap((section) => section.links.map((link) => link.href));
}

function privateTokens(value) {
  const tokens = new Set();
  for (const href of hrefs(value)) {
    for (const part of href.split(/[/?#=&:]+/)) {
      if (part.length >= 20 && /[0-9]/.test(part) && /[A-Za-z]/.test(part)) tokens.add(part);
    }
  }
  return [...tokens];
}

async function walk(dir, visit) {
  const entries = await readdir(dir);
  for (const name of entries) {
    if (skipDir.has(name) && dir === root) continue;
    const abs = join(dir, name);
    const info = await stat(abs);
    if (info.isDirectory()) {
      if (skipDir.has(name)) continue;
      await walk(abs, visit);
      continue;
    }
    if (!info.isFile() || info.size > 1_000_000) continue;
    if (/\.(png|woff2|woff|ico|jpg|jpeg|webp|gif)$/i.test(name)) continue;
    await visit(abs);
  }
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
  throw new Error(message);
}
