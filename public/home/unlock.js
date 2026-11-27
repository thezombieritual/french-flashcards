// Decrypts the vault in index.html. Same PBKDF2-SHA256 / AES-GCM steps as home/vault.mjs.

const STORE = 'paul-home-key';
const MIN_ITER = 200000;
const MAX_ITER = 1000000;

const gate = document.querySelector('#gate');
const form = document.querySelector('#gate-form');
const passwordInput = document.querySelector('#password');
const rememberInput = document.querySelector('#remember');
const submitButton = document.querySelector('#unlock');
const status = document.querySelector('#status');
const menu = document.querySelector('#menu');
const app = document.querySelector('#app');
const lockButton = document.querySelector('#lock');

let busy = false;

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void unlockFromPassword();
});

lockButton.addEventListener('click', () => {
  clearStored();
  busy = false;
  rememberInput.checked = false;
  passwordInput.value = '';
  passwordInput.removeAttribute('aria-invalid');
  submitButton.disabled = false;
  submitButton.textContent = 'Unlock';
  menu.replaceChildren();
  app.hidden = true;
  lockButton.hidden = true;
  gate.hidden = false;
  setStatus('');
  passwordInput.focus();
});

const stored = readStored();
if (stored) {
  rememberInput.checked = stored.remember;
  submitButton.disabled = true;
  setStatus('Unlocking…');
  try {
    await unlockFromStored(stored);
  } catch {
    clearStored();
    rememberInput.checked = false;
    submitButton.disabled = false;
    setStatus('Saved unlock no longer works. Enter the password.', 'error');
    passwordInput.focus();
  }
} else {
  passwordInput.focus();
}

async function unlockFromPassword() {
  const password = passwordInput.value;
  if (!password || busy) return;
  busy = true;
  submitButton.disabled = true;
  submitButton.textContent = 'Unlocking…';
  passwordInput.removeAttribute('aria-invalid');
  setStatus('Unlocking…');
  await yieldToPaint();
  try {
    const vault = readVault();
    const raw = await deriveRaw(password, vault);
    const data = await decryptMenu(raw, vault);
    writeStored(bytesToB64(raw), rememberInput.checked);
    passwordInput.value = '';
    showMenu(data);
  } catch (error) {
    passwordInput.setAttribute('aria-invalid', 'true');
    setStatus(isAuthFailure(error) ? 'Wrong password.' : 'Could not unlock.', 'error');
    passwordInput.select();
  } finally {
    busy = false;
    submitButton.disabled = false;
    submitButton.textContent = 'Unlock';
  }
}

async function unlockFromStored(saved) {
  const raw = b64ToBytes(saved.raw);
  if (raw.byteLength !== 32) throw new Error('Bad key');
  showMenu(await decryptMenu(raw, readVault()));
}

function showMenu(data) {
  renderMenu(data);
  gate.hidden = true;
  app.hidden = false;
  lockButton.hidden = false;
  setStatus('Unlocked.', 'sr');
  const heading = menu.querySelector('h2');
  if (heading instanceof HTMLElement) {
    heading.tabIndex = -1;
    heading.focus();
  }
}

function renderMenu(data) {
  if (!data || !Array.isArray(data.sections)) throw new Error('Bad menu');
  menu.replaceChildren();
  for (const section of data.sections) {
    const block = document.createElement('section');
    block.className = 'section';
    const heading = document.createElement('h2');
    heading.textContent = typeof section.title === 'string' ? section.title : '';
    block.append(heading);

    const card = document.createElement('div');
    card.className = 'card';
    if (typeof section.note === 'string' && section.note) {
      const note = document.createElement('p');
      note.className = 'note';
      note.textContent = section.note;
      card.append(note);
    }

    const list = document.createElement('ul');
    const links = Array.isArray(section.links) ? section.links : [];
    for (const link of links) {
      const parsed = safeHref(link && link.href);
      if (!parsed || typeof link.label !== 'string' || !link.label) continue;
      const item = document.createElement('li');
      const anchor = document.createElement('a');
      anchor.className = 'link';
      anchor.setAttribute('href', link.href);
      const copy = document.createElement('span');
      copy.className = 'link-text';
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = link.label;
      copy.append(label);
      if (typeof link.hint === 'string' && link.hint) {
        const hint = document.createElement('span');
        hint.className = 'hint';
        hint.textContent = link.hint;
        copy.append(hint);
      }
      anchor.append(copy);
      if (parsed.protocol === 'https:') {
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        const extra = document.createElement('span');
        extra.className = 'sr';
        extra.textContent = 'Opens in a new tab.';
        anchor.append(extra);
      }
      const chevron = document.createElement('span');
      chevron.className = 'chev';
      chevron.setAttribute('aria-hidden', 'true');
      anchor.append(chevron);
      item.append(anchor);
      list.append(item);
    }
    card.append(list);
    block.append(card);
    menu.append(block);
  }
}

function safeHref(value) {
  if (typeof value !== 'string') return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'grokbot:') || url.username || url.password) return null;
  return url;
}

function readVault() {
  const el = document.getElementById('vault');
  const blob = JSON.parse(el && el.textContent ? el.textContent : '');
  if (!blob || blob.v !== 1 || blob.kdf !== 'PBKDF2-SHA256') throw new Error('Unsupported vault');
  if (!Number.isInteger(blob.iter) || blob.iter < MIN_ITER || blob.iter > MAX_ITER) {
    throw new Error('Unexpected PBKDF2 iteration count');
  }
  return blob;
}

async function deriveRaw(password, vault) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: b64ToBytes(vault.salt),
      iterations: vault.iter,
    },
    material,
    256,
  );
  return new Uint8Array(bits);
}

async function decryptMenu(raw, vault) {
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(vault.iv) },
    key,
    b64ToBytes(vault.ct),
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

function readStored() {
  const local = storageGet(localStorage);
  if (local) return { raw: local, remember: true };
  const session = storageGet(sessionStorage);
  if (session) return { raw: session, remember: false };
  return null;
}

function writeStored(value, remember) {
  storageSet(sessionStorage, value);
  if (remember) storageSet(localStorage, value);
  else storageRemove(localStorage);
}

function clearStored() {
  storageRemove(localStorage);
  storageRemove(sessionStorage);
}

function storageGet(store) {
  try {
    return store.getItem(STORE);
  } catch {
    return null;
  }
}

function storageSet(store, value) {
  try {
    store.setItem(STORE, value);
  } catch {
    /* Storage can be blocked. The menu still opens for this view. */
  }
}

function storageRemove(store) {
  try {
    store.removeItem(STORE);
  } catch {
    /* ignore */
  }
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function setStatus(message, kind) {
  status.textContent = message;
  status.className = kind === 'error' ? 'status error' : kind === 'sr' ? 'status sr' : 'status';
}

function isAuthFailure(error) {
  return !!error && (error.name === 'OperationError' || error.name === 'InvalidAccessError');
}

function yieldToPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}
