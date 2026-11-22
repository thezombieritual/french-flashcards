import type { Card } from './types';

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatFrench(card: Pick<Card, 'article' | 'french'>): string {
  if (!card.article) return card.french;
  if (card.article.endsWith("'")) return `${card.article}${card.french}`;
  return `${card.article} ${card.french}`;
}

const TOPIC_LABELS: Record<string, string> = {
  greetings: 'Greetings',
  people: 'People',
  family: 'Family',
  home: 'Home',
  food: 'Food',
  numbers: 'Numbers',
  days: 'Days',
  time: 'Time',
  verbs: 'Verbs',
  phrases: 'Phrases',
};

export function topicLabel(topic: string): string {
  return TOPIC_LABELS[topic] ?? topic;
}

export function iconUrl(icon: string): string {
  return `${import.meta.env.BASE_URL}icons/${icon}`;
}

export function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour >= 5 && hour < 18) return 'Bonjour';
  return 'Bonsoir';
}
