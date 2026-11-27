// Headless browser check for the published home page and the French app beside it.
//
//   SITE_PASSWORD='…' node home/browser-check.mjs
//
// Serves dist/ the way GitHub Pages does. Run `npm run build` first.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { findPlaintext, secretStrings } from './vault.mjs';

const homeDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(homeDir);
const password = process.env.SITE_PASSWORD;
const port = 4173;
const origin = `http://127.0.0.1:${port}`;
const homeUrl = `${origin}/french-flashcards/home/`;
const frenchUrl = `${origin}/french-flashcards/`;
const shots = '/tmp/paul-home-shots';

if (!password) {
  console.error('Set SITE_PASSWORD in the environment.');
  process.exit(1);
}

const menu = JSON.parse(await readFile(join(homeDir, 'links.json'), 'utf8'));
await mkdir(shots, { recursive: true });

const sw = await readFile(join(root, 'dist/sw.js'), 'utf8');
assert.equal(sw.includes('home/index.html'), false, 'service worker precaches the home page');
assert.equal(sw.includes('home/unlock.js'), false, 'service worker precaches the unlock script');
assert.match(sw, /home/, 'service worker does not mention the home denylist');

let previewLog = '';
const preview = spawn(
  process.execPath,
  [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
);
const keepLog = (chunk) => {
  previewLog += chunk.toString();
  if (previewLog.length > 30000) previewLog = previewLog.slice(-30000);
};
preview.stdout.on('data', keepLog);
preview.stderr.on('data', keepLog);

let browser;
try {
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  await waitFor(`${homeUrl}`);
  const raw = await fetch(homeUrl);
  assert.equal(raw.status, 200);
  const html = await raw.text();
  assert.match(html, /noindex/);
  const leaked = findPlaintext(html, secretStrings(menu), password);
  assert.equal(leaked, null, leaked ? `plaintext in served html (${leaked.kind})` : '');

  const robots = await (await fetch(`${origin}/french-flashcards/robots.txt`)).text();
  const homeRobots = await (await fetch(`${origin}/french-flashcards/home/robots.txt`)).text();
  assert.match(robots, /Disallow:\s*\/home\//);
  assert.match(homeRobots, /Disallow:\s*\//);
  assert.doesNotMatch(robots, /^Disallow:\s*\/\s*$/m);

  await checkGateAndMenu();
  await checkFrenchAppStillOwnsItsRoute();
  console.log('browser-check ok');
} catch (error) {
  console.error(previewLog);
  throw error;
} finally {
  if (browser) await browser.close();
  preview.kill('SIGTERM');
}

async function checkGateAndMenu() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light', deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.setDefaultTimeout(20000);

  await page.goto(homeUrl);
  await page.getByLabel('Password').waitFor();
  assert.equal(await page.getByRole('link').count(), 0);
  assert.equal(await page.getByRole('checkbox', { name: /Remember on this device/ }).isChecked(), false);
  await shot(page, 'locked-phone-light.png');
  await assertContrast(page, 'light gate');
  await assertTargets(page, 'locked phone');
  await assertNoOverflow(page);

  await page.setViewportSize({ width: 320, height: 700 });
  await assertNoOverflow(page);
  await assertTargets(page, 'locked 320');
  await page.setViewportSize({ width: 1280, height: 800 });
  await shot(page, 'locked-laptop-light.png');
  const wrap = await page.locator('.wrap').boundingBox();
  assert.ok(wrap && wrap.width <= 640 + 2, `wrap is ${wrap && wrap.width}px wide`);

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'locked-phone-dark.png');
  await assertContrast(page, 'dark gate');

  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByText('Wrong password.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link').count(), 0);
  await assertContrast(page, 'wrong password');
  await shot(page, 'wrong-password-phone.png');

  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('link', { name: 'Todoist' }).waitFor();
  await assertMenu(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await shot(page, 'open-phone-light.png', true);
  await assertContrast(page, 'light menu');
  await assertTargets(page, 'open phone');
  await assertNoOverflow(page);

  await page.setViewportSize({ width: 1280, height: 800 });
  await shot(page, 'open-laptop-light.png', true);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'open-phone-dark.png', true);
  await assertContrast(page, 'dark menu');

  const saved = await page.evaluate(() => ({
    local: localStorage.getItem('paul-home-key'),
    session: sessionStorage.getItem('paul-home-key'),
  }));
  assert.equal(saved.local, null);
  assert.ok(saved.session && !saved.session.includes(password));

  await page.reload();
  await page.getByRole('link', { name: 'Todoist' }).waitFor();
  const freshTab = await context.newPage();
  await freshTab.goto(homeUrl);
  await freshTab.getByLabel('Password').waitFor();
  assert.equal(await freshTab.getByRole('link').count(), 0);
  await freshTab.close();

  await page.getByRole('button', { name: 'Lock' }).click();
  await page.getByLabel('Password').waitFor();
  assert.equal(await page.getByRole('link').count(), 0);
  const cleared = await page.evaluate(() => ({
    local: localStorage.getItem('paul-home-key'),
    session: sessionStorage.getItem('paul-home-key'),
  }));
  assert.equal(cleared.local, null);
  assert.equal(cleared.session, null);

  await page.getByRole('checkbox', { name: /Remember on this device/ }).check();
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('link', { name: 'Todoist' }).waitFor();
  const remembered = await page.evaluate(() => localStorage.getItem('paul-home-key'));
  assert.ok(remembered && !remembered.includes(password));
  const otherTab = await context.newPage();
  await otherTab.goto(homeUrl);
  await otherTab.getByRole('link', { name: 'Todoist' }).waitFor();
  await otherTab.getByRole('button', { name: 'Lock' }).click();
  await otherTab.getByLabel('Password').waitFor();
  const forgotten = await otherTab.evaluate(() => ({
    local: localStorage.getItem('paul-home-key'),
    session: sessionStorage.getItem('paul-home-key'),
  }));
  assert.equal(forgotten.local, null);
  assert.equal(forgotten.session, null);
  await otherTab.close();

  assert.deepEqual(errors, []);
  await context.close();
}

async function checkFrenchAppStillOwnsItsRoute() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(frenchUrl);
  await page.getByText('Due today').waitFor();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await shot(page, 'french-app-phone.png');
  await page.goto(homeUrl);
  await page.getByLabel('Password').waitFor();
  assert.equal(await page.getByText('Due today').count(), 0);
  await page.goto(frenchUrl);
  await page.getByText('Due today').waitFor();
  await context.close();
}

async function assertMenu(page) {
  const headings = await page.getByRole('heading', { level: 2 }).allTextContents();
  assert.deepEqual(headings, menu.sections.map((section) => section.title));
  const links = menu.sections.flatMap((section) => section.links);
  const anchors = page.locator('a.link');
  assert.equal(await anchors.count(), links.length);
  for (let i = 0; i < links.length; i += 1) {
    const link = links[i];
    const anchor = anchors.nth(i);
    assert.equal(await anchor.getAttribute('href'), link.href, link.label);
    const text = await anchor.innerText();
    assert.ok(text.includes(link.label), link.label);
    if (link.href.startsWith('grokbot:')) {
      assert.equal(await anchor.getAttribute('target'), null, link.label);
      assert.match(text, /Opens in the Grok Bot app/);
    } else {
      assert.equal(await anchor.getAttribute('target'), '_blank', link.label);
      assert.match(await anchor.getAttribute('rel'), /noopener/);
    }
    if (link.hint) assert.ok(text.includes(link.hint), link.label);
  }
  const bots = page.locator('section', { has: page.getByRole('heading', { name: 'Bots', exact: true }) });
  const botsText = await bots.innerText();
  assert.match(botsText, /These links only open in the Grok Bot app/);
  assert.ok(botsText.indexOf('These links only') < botsText.indexOf('Chun Li'));
}

async function assertTargets(page, label) {
  const boxes = await page.locator('a.link, button, .remember, input[type="password"]').evaluateAll((els) =>
    els.filter((el) => !el.hidden && el.getClientRects().length > 0).map((el) => {
      const rect = el.getBoundingClientRect();
      return { h: rect.height, w: rect.width, text: (el.innerText || el.getAttribute('aria-label') || el.id || '').trim().slice(0, 40) };
    }),
  );
  for (const box of boxes) {
    assert.ok(box.h >= 44 && box.w >= 44, `${label} target ${box.h.toFixed(0)}x${box.w.toFixed(0)} ${box.text}`);
  }
}

async function assertNoOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `horizontal overflow ${overflow}px`);
}

async function assertContrast(page, label) {
  const samples = await page.evaluate(() => {
    const pick = (selector) => {
      const el = document.querySelector(selector);
      if (!el || el.hidden || el.closest('[hidden]')) return null;
      const style = getComputedStyle(el);
      let node = el;
      let bg = 'rgba(0, 0, 0, 0)';
      while (node && node instanceof Element) {
        const color = getComputedStyle(node).backgroundColor;
        if (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') {
          bg = color;
          break;
        }
        node = node.parentElement;
      }
      return { selector, fg: style.color, bg, size: parseFloat(style.fontSize) };
    };
    return ['h1', '.lede', '.field', '.remember-help', '.primary', 'h2', '.label', '.hint', '.note', '.status.error']
      .map(pick)
      .filter(Boolean);
  });
  for (const sample of samples) {
    const ratio = contrast(sample.fg, sample.bg);
    assert.ok(ratio >= 4.5, `${label} ${sample.selector} contrast ${ratio.toFixed(2)} ${sample.fg} on ${sample.bg}`);
  }
}

function contrast(fg, bg) {
  const L1 = luminance(parseRgb(fg));
  const L2 = luminance(parseRgb(bg));
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

function parseRgb(color) {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) throw new Error(`unparsed color ${color}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function luminance([r, g, b]) {
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

async function shot(page, name, fullPage = false) {
  await page.screenshot({ path: join(shots, name), fullPage });
}

async function waitFor(url) {
  const deadline = Date.now() + 20000;
  let last = 'not started';
  while (Date.now() < deadline) {
    if (preview.exitCode != null) throw new Error(`preview exited ${preview.exitCode}\n${previewLog}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
      last = `status ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`preview did not serve ${url}: ${last}\n${previewLog}`);
}
