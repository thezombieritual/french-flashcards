export type Grade = 'again' | 'hard' | 'good' | 'easy';
export type CardStatus = 'new' | 'learning' | 'review';
export type Article = 'le' | 'la' | "l'" | 'les';

export interface Card {
  id: string;
  deckId: string;
  topic: string;
  french: string;
  article: Article | null;
  english: string;
  example: string;
  exampleEn: string;
  icon: string;
  note?: string;
}

export interface Deck {
  id: string;
  name: string;
  description: string;
  level: string;
  cards: Card[];
}

export interface PlannedDeck {
  id: string;
  name: string;
  level: string;
  blurb: string;
}

export interface CardState {
  cardId: string;
  ease: number;
  intervalDays: number;
  repetitions: number;
  due: number;
  lapses: number;
  lastReview: number | null;
  updatedAt: number;
  state: CardStatus;
  learningStep: number;
  introducedOn: string | null;
}

export interface ReviewLog {
  id: string;
  cardId: string;
  grade: Grade;
  reviewedAt: number;
  synced?: boolean;
}

export interface Settings {
  newPerDay: number;
  autoplay: boolean;
  disabledDeckIds: string[];
  updatedAt: number;
}

export interface DirtySet {
  cardIds: string[];
  reviewIds: string[];
  settings: boolean;
}
