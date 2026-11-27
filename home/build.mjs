// Build the private home page.
//
//   SITE_PASSWORD='…' node home/build.mjs
//
// Reads home/links.json (gitignored; override with LINKS_FILE) and writes
// public/home/index.html. The password and the plaintext menu stay out of git.

import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  b64ToBytes,
  decryptWithRawKey,
  deriveAesRaw,
  encryptJson,
  assertMenu,
  findPlaintext,
  secretStrings,
} from './vault.mjs';

const homeDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(homeDir);
const linksPath = process.env.LINKS_FILE || join(homeDir, 'links.json');
const templatePath = join(homeDir, 'page.template.html');
const outPath = join(root, 'public/home/index.html');

const password = process.env.SITE_PASSWORD;
if (!password) {
  console.error('Set SITE_PASSWORD in the environment. It is not read from a file.');
  process.exit(1);
}

const menu = JSON.parse(await readFile(linksPath, 'utf8'));
assertMenu(menu);
const secrets = secretStrings(menu);

const template = await readFile(templatePath, 'utf8');
const parts = template.split('___VAULT_JSON___');
if (parts.length !== 2) {
  throw new Error('page.template.html must contain the vault placeholder once');
}
const templateLeak = findPlaintext(template, secrets, password);
if (templateLeak) {
  throw new Error(`page.template.html contains menu text (${templateLeak.kind})`);
}

let html = '';
for (let attempt = 1; attempt <= 8; attempt += 1) {
  const blob = encryptJson(password, menu);
  const salt = b64ToBytes(blob.salt);
  const raw = await deriveAesRaw(password, salt, blob.iter);
  const nodeKey = pbkdf2Sync(password, salt, blob.iter, 32, 'sha256');
  assert.equal(Buffer.compare(nodeKey, Buffer.from(raw)), 0);
  assert.deepEqual(await decryptWithRawKey(blob, raw), menu);
  const wrong = await deriveAesRaw(`${password}!`, salt, blob.iter);
  await assert.rejects(() => decryptWithRawKey(blob, wrong));

  const vaultJson = JSON.stringify(blob);
  if (vaultJson.includes('<')) throw new Error('Vault JSON is not safe to embed');
  const candidate = parts[0] + vaultJson + parts[1];
  const hit = findPlaintext(candidate, secrets, password);
  if (!hit) {
    html = candidate;
    break;
  }
  if (hit.kind !== 'vault' || attempt === 8) {
    throw new Error(`Built page contains menu text (${hit.kind})`);
  }
}

await writeFile(`${outPath}.tmp`, html);
await rename(`${outPath}.tmp`, outPath);
const count = menu.sections.reduce((sum, section) => sum + section.links.length, 0);
console.log(`Wrote public/home/index.html (${count} links encrypted).`);
