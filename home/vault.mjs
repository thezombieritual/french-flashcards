import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';

export const ITERATIONS = 200_000;
const MAX_ITERATIONS = 1_000_000;

export function encryptJson(password, value) {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('Password is missing');
  }
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iter: ITERATIONS,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
  };
}

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export async function deriveAesRaw(password, salt, iterations) {
  if (!Number.isInteger(iterations) || iterations < ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new Error('Unexpected PBKDF2 iteration count');
  }
  const saltBytes = new Uint8Array(salt);
  const material = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: saltBytes,
      iterations,
    },
    material,
    256,
  );
  return new Uint8Array(bits);
}

export async function decryptWithRawKey(blob, rawKey) {
  if (!blob || blob.v !== 1 || blob.kdf !== 'PBKDF2-SHA256') {
    throw new Error('Unsupported vault');
  }
  if (!Number.isInteger(blob.iter) || blob.iter < ITERATIONS || blob.iter > MAX_ITERATIONS) {
    throw new Error('Unexpected PBKDF2 iteration count');
  }
  const raw = new Uint8Array(rawKey);
  if (raw.byteLength !== 32) throw new Error('Bad key');
  const iv = b64ToBytes(blob.iv);
  const ct = b64ToBytes(blob.ct);
  if (iv.byteLength !== 12) throw new Error('Bad IV');
  const key = await globalThis.crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(plain));
}

export function assertMenu(menu) {
  if (!menu || !Array.isArray(menu.sections) || menu.sections.length === 0) {
    throw new Error('links.json needs a non-empty sections array');
  }
  for (const section of menu.sections) {
    if (!text(section.title)) throw new Error('Every section needs a title');
    if (section.note != null && typeof section.note !== 'string') throw new Error('A section note must be text');
    if (!Array.isArray(section.links) || section.links.length === 0) {
      throw new Error(`Section “${section.title}” needs links`);
    }
    for (const link of section.links) {
      if (!text(link.label)) throw new Error(`A link in “${section.title}” needs a label`);
      let url;
      try {
        url = new URL(link.href);
      } catch {
        throw new Error(`Invalid link URL for “${link.label}”`);
      }
      if (url.protocol !== 'https:' && url.protocol !== 'grokbot:') {
        throw new Error(`Link “${link.label}” must use https or grokbot`);
      }
      if (url.username || url.password) throw new Error(`Link “${link.label}” must not include credentials`);
      if (link.hint != null && typeof link.hint !== 'string') {
        throw new Error(`Hint for “${link.label}” must be text`);
      }
    }
  }
}

export function secretStrings(menu) {
  const found = [];
  const walk = (value) => {
    if (typeof value === 'string') found.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(menu);
  return found;
}

// Short titles must match as words, so the robots meta tag is not "Bots".
// The ciphertext is checked as a raw substring, which retries until a collision is gone.
export function findPlaintext(html, secrets, password) {
  if (password && html.includes(password)) return { kind: 'password' };
  if (html.includes('https://') || html.includes('http://') || html.includes('grokbot://')) return { kind: 'url' };
  const match = html.match(/<script id="vault"[^>]*>([\s\S]*?)<\/script>/);
  const vault = match ? match[1] : '';
  const shell = match ? html.slice(0, match.index) + html.slice(match.index + match[0].length) : html;
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length < 4 || secret === password) continue;
    if (vault.toLowerCase().includes(secret.toLowerCase())) return { kind: 'vault' };
    if (hasWord(shell, secret)) return { kind: 'shell' };
  }
  return null;
}

function hasWord(haystack, needle) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9'-])${escaped}([^A-Za-z0-9'-]|$)`, 'i').test(haystack);
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
