import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('private home page', () => {
  it('roundtrips AES-GCM and PBKDF2 without the site password', () => {
    const out = execFileSync(process.execPath, ['home/self-test.mjs'], { encoding: 'utf8' });
    expect(out).toContain('self-test ok');
  });

  it('ships a password gate and no plaintext urls', () => {
    const html = read('../public/home/index.html');
    const unlock = read('../public/home/unlock.js');
    const robots = read('../public/robots.txt');
    const homeRobots = read('../public/home/robots.txt');

    expect(html).toContain('name="robots" content="noindex');
    expect(html).toContain("Paul's Home");
    expect(html).toContain('type="password"');
    expect(html).toContain('Remember on this device');
    expect(html).toContain('"kdf":"PBKDF2-SHA256"');
    expect(html).toContain('"iter":200000');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/grokbot:\/\//);
    expect(unlock).not.toMatch(/https?:\/\//);
    expect(unlock).not.toMatch(/grokbot:\/\//);
    expect(robots).toContain('Disallow: /home/');
    expect(robots).toContain('Disallow: /french-flashcards/home/');
    expect(robots).not.toMatch(/^Disallow:\s*\/\s*$/m);
    expect(homeRobots).toMatch(/^Disallow:\s*\/\s*$/m);
  });
});
