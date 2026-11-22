import indexFile from '../decks/index.json';
import type { Article, Card, Deck, PlannedDeck } from './types';

const ARTICLES: readonly Article[] = ['le', 'la', "l'", 'les'];

interface DeckFile {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  level?: unknown;
  cards?: unknown;
}

function isArticle(value: unknown): value is Article | null {
  return value === null || (typeof value === 'string' && (ARTICLES as readonly string[]).includes(value));
}

function parseCard(raw: unknown, deckId: string, index: number): Card {
  if (!raw || typeof raw !== 'object') throw new Error(`Card ${index} in ${deckId} is not an object`);
  const card = raw as Record<string, unknown>;
  const id = card.id;
  const french = card.french;
  const english = card.english;
  const example = card.example;
  const exampleEn = card.exampleEn;
  const topic = card.topic;
  const icon = card.icon;
  if (typeof id !== 'string' || !id) throw new Error(`Card ${index} in ${deckId} needs an id`);
  if (typeof french !== 'string' || !french) throw new Error(`${id} needs french`);
  if (typeof english !== 'string' || !english) throw new Error(`${id} needs english`);
  if (typeof example !== 'string' || !example) throw new Error(`${id} needs example`);
  if (typeof exampleEn !== 'string' || !exampleEn) throw new Error(`${id} needs exampleEn`);
  if (typeof topic !== 'string' || !topic) throw new Error(`${id} needs topic`);
  if (typeof icon !== 'string' || !icon) throw new Error(`${id} needs icon`);
  if (!isArticle(card.article)) throw new Error(`${id} has an unknown article`);
  const note = card.note;
  return {
    id,
    deckId,
    topic,
    french,
    article: card.article,
    english,
    example,
    exampleEn,
    icon,
    ...(typeof note === 'string' && note ? { note } : {}),
  };
}

export function parseDeck(data: unknown, file: string): Deck {
  if (!data || typeof data !== 'object') throw new Error(`${file} is not a deck object`);
  const deck = data as DeckFile;
  if (typeof deck.id !== 'string' || !deck.id) throw new Error(`${file} needs an id`);
  if (typeof deck.name !== 'string' || !deck.name) throw new Error(`${file} needs a name`);
  if (typeof deck.description !== 'string') throw new Error(`${file} needs a description`);
  if (typeof deck.level !== 'string' || !deck.level) throw new Error(`${file} needs a level`);
  if (!Array.isArray(deck.cards)) throw new Error(`${file} needs a cards array`);
  return {
    id: deck.id,
    name: deck.name,
    description: deck.description,
    level: deck.level,
    cards: deck.cards.map((card, index) => parseCard(card, deck.id as string, index)),
  };
}

function plannedFromIndex(): PlannedDeck[] {
  const planned = (indexFile as { planned?: unknown }).planned;
  if (!Array.isArray(planned)) return [];
  return planned.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.level !== 'string') return [];
    return [
      {
        id: row.id,
        name: row.name,
        level: row.level,
        blurb: typeof row.blurb === 'string' ? row.blurb : '',
      },
    ];
  });
}

const deckModules = import.meta.glob('../decks/*.json', { eager: true, import: 'default' });

export function loadCatalog(): { decks: Deck[]; planned: PlannedDeck[] } {
  const files = (indexFile as { files?: unknown }).files;
  if (!Array.isArray(files)) throw new Error('decks/index.json needs a files array');
  const decks = files.map((file) => {
    if (typeof file !== 'string') throw new Error('Deck filenames must be strings');
    const key = `../decks/${file}`;
    const data = deckModules[key];
    if (!data) throw new Error(`Missing deck file ${file}. Add it under decks/ and list it in decks/index.json.`);
    return parseDeck(data, file);
  });
  const seen = new Set<string>();
  for (const deck of decks) {
    for (const card of deck.cards) {
      if (seen.has(card.id)) throw new Error(`Duplicate card id ${card.id}`);
      seen.add(card.id);
    }
  }
  return { decks, planned: plannedFromIndex() };
}

export function allCards(decks: Deck[]): Card[] {
  return decks.flatMap((deck) => deck.cards);
}
