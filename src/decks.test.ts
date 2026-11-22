import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCatalog } from './decks';
import { formatFrench } from './text';

const vowel = /^[aeiouàâäéèêëîïôùûüœh]/i;

describe('starter deck', () => {
  const { decks, planned } = loadCatalog();
  const cards = decks.flatMap((deck) => deck.cards);

  it('ships a family-life deck of about 150 cards and leaves room for later decks', () => {
    expect(decks.map((deck) => deck.id)).toEqual(['family-life']);
    expect(cards.length).toBeGreaterThanOrEqual(140);
    expect(cards.length).toBeLessThanOrEqual(190);
    expect(planned.map((deck) => deck.id)).toEqual(['travel', 'health', 'work', 'civic-life', 'b2-core']);
  });

  it('gives every card a picture, an article where it is a noun, and a spoken example', () => {
    const ids = new Set<string>();
    for (const card of cards) {
      expect(ids.has(card.id), card.id).toBe(false);
      ids.add(card.id);
      expect(card.french.length).toBeGreaterThan(0);
      expect(card.english.length).toBeGreaterThan(0);
      expect(card.example.length).toBeGreaterThan(0);
      expect(card.exampleEn.length).toBeGreaterThan(0);
      if (card.article === "l'") expect(vowel.test(card.french), card.id).toBe(true);
      if (card.article === 'le' || card.article === 'la') expect(vowel.test(card.french), card.id).toBe(false);
      const file = path.join('public/icons', card.icon);
      expect(fs.existsSync(file), `${card.id} ${card.icon}`).toBe(true);
      expect(fs.readFileSync(file, 'utf8')).toContain('<svg');
      expect(formatFrench(card).length).toBeGreaterThan(1);
    }
  });
});
