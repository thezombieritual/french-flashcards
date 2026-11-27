import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { ITERATIONS, b64ToBytes, bytesToB64, decryptWithRawKey, deriveAesRaw, encryptJson } from './vault.mjs';

const menu = {
  sections: [
    {
      title: 'Sample',
      note: 'A note',
      links: [{ label: 'Example', href: 'https://example.com/path', hint: 'Hint' }],
    },
  ],
};
const password = 'sample-password-not-the-site';

const first = encryptJson(password, menu);
const second = encryptJson(password, menu);
assert.equal(first.v, 1);
assert.equal(first.kdf, 'PBKDF2-SHA256');
assert.equal(first.iter, ITERATIONS);
assert.equal(b64ToBytes(first.salt).byteLength, 16);
assert.equal(b64ToBytes(first.iv).byteLength, 12);
assert.notEqual(first.salt, second.salt);
assert.notEqual(first.iv, second.iv);
assert.notEqual(first.ct, second.ct);
assert.equal(JSON.stringify(first).includes('example.com'), false);

const salt = b64ToBytes(first.salt);
const raw = await deriveAesRaw(password, salt, first.iter);
const nodeKey = pbkdf2Sync(password, salt, first.iter, 32, 'sha256');
assert.equal(Buffer.compare(nodeKey, Buffer.from(raw)), 0);
assert.deepEqual(b64ToBytes(bytesToB64(raw)), raw);

const opened = await decryptWithRawKey(first, raw);
assert.deepEqual(opened, menu);

const wrong = await deriveAesRaw(`${password}-no`, salt, first.iter);
await assert.rejects(() => decryptWithRawKey(first, wrong));

const weakened = { ...first, iter: 1 };
await assert.rejects(() => decryptWithRawKey(weakened, raw));

console.log('self-test ok');
