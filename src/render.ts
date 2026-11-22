import type { Card, Deck, Grade, PlannedDeck, Settings } from './types';
import { escapeHtml, formatFrench, greeting, iconUrl, topicLabel } from './text';
import type { Summary } from './stats';

export type View = 'home' | 'study' | 'tricky' | 'settings';

export interface StudyModel {
  card: Card | null;
  left: number;
  flipped: boolean;
  previews: Record<Grade, string>;
  counts: Record<Grade, number>;
  upcoming: { count: number; minutes: number } | null;
  lapses: number;
}

export interface TrickyRow {
  card: Card;
  lapses: number;
}

export interface SettingsModel {
  settings: Settings;
  configured: boolean;
  email: string | null;
  message: string;
  busy: boolean;
}

function tabbar(view: View): string {
  const tab = (id: View, label: string, icon: string) =>
    `<a href="#/${id === 'home' ? '' : id}" ${view === id ? 'aria-current="page"' : ''}>${icon}${label}</a>`;
  return `<nav class="tabbar">
    ${tab('home', 'Home', house)}
    ${tab('tricky', 'Tricky', alert)}
    ${tab('settings', 'Settings', gear)}
  </nav>`;
}

const house = `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 4 3 11h2v8h5v-5h4v5h5v-8h2z"/></svg>`;
const alert = `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3 2 20h20zm0 6 5.2 9H6.8zm-1 3v3h2v-3zm0 4v2h2v-2z"/></svg>`;
const gear = `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 8a4 4 0 1 0 .01 8.01A4 4 0 0 0 12 8m8.9 3-1.7-.3a7 7 0 0 0-.8-1.9l1-1.4-1.4-1.4-1.4 1a7 7 0 0 0-1.9-.8L14 4h-4l-.3 1.7a7 7 0 0 0-1.9.8l-1.4-1L4.9 6.9l1 1.4a7 7 0 0 0-.8 1.9L3.4 11v2l1.7.3c.2.7.4 1.3.8 1.9l-1 1.4 1.4 1.4 1.4-1c.6.4 1.2.6 1.9.8l.3 1.7h4l.3-1.7c.7-.2 1.3-.4 1.9-.8l1.4 1 1.4-1.4-1-1.4c.4-.6.6-1.2.8-1.9l1.7-.3z"/></svg>`;

export function renderHome(
  summary: Summary,
  decks: Deck[],
  planned: PlannedDeck[],
  settings: Settings,
  syncLabel: string,
  now: Date,
): string {
  const studyLabel = summary.due + summary.newLeft > 0 ? 'Study' : "You're caught up";
  const detail =
    summary.due + summary.newLeft === 0
      ? 'Nothing is waiting. New cards come back tomorrow.'
      : `${summary.due} due · ${summary.newLeft} new left today`;
  const remembered =
    summary.accuracy === null ? 'No reviews yet' : `${Math.round(summary.accuracy * 100)}% remembered`;
  const deckRows = decks
    .map((deck) => {
      const on = !settings.disabledDeckIds.includes(deck.id);
      return `<article class="deck">
        <div>
          <p class="level">${escapeHtml(deck.level)} · ${deck.cards.length} cards</p>
          <h2>${escapeHtml(deck.name)}</h2>
          <p>${escapeHtml(deck.description)}</p>
        </div>
        <button class="switch" type="button" role="switch" aria-checked="${on}" aria-label="Include ${escapeHtml(deck.name)} in study" data-action="toggle-deck" data-deck="${escapeHtml(deck.id)}"></button>
      </article>`;
    })
    .join('');
  const later = planned
    .map(
      (deck) =>
        `<div class="planned"><strong>${escapeHtml(deck.name)}</strong><p>${escapeHtml(deck.level)} · ${escapeHtml(deck.blurb)}</p></div>`,
    )
    .join('');
  return `<main class="screen">
    <p class="eyebrow">Chaque jour</p>
    <h1>${greeting(now)}, Paul</h1>
    <p class="lede">French for home, and the road to B2.</p>
    <section class="stats" aria-label="Today">
      <div class="stat"><b>${summary.due}</b><span>Due today</span></div>
      <div class="stat"><b>${summary.newLeft}</b><span>New left</span></div>
      <div class="stat"><b>${summary.streak}</b><span>Day streak</span></div>
    </section>
    <a class="study-btn" href="#/study">${studyLabel}</a>
    <p class="quiet">${detail}</p>
    <p class="quiet">${summary.learned} cards learned · ${remembered} · ${summary.reviewsToday} today</p>
    <a class="link-row" href="#/tricky">Tricky cards <span>${summary.tricky}</span></a>
    <p class="quiet">${escapeHtml(syncLabel)}</p>
    <h2 class="section-title">Decks</h2>
    ${deckRows}
    <h2 class="section-title">Later</h2>
    ${later}
  </main>${tabbar('home')}`;
}

export function renderStudy(model: StudyModel): string {
  if (!model.card) {
    const upcoming = model.upcoming
      ? `<p>${model.upcoming.count} card${model.upcoming.count === 1 ? '' : 's'} come back in about ${model.upcoming.minutes} min.</p>
         <button class="btn primary" type="button" data-action="refresh-session">Check for them</button>`
      : `<p>Reviews that are due, and today's new cards, are done.</p>`;
    return `<section class="study">
      <header class="study-top"><button class="close" type="button" data-action="close" aria-label="Close">×</button></header>
      <div class="done">
        <div class="done-card">
          <p class="eyebrow">Session</p>
          <h2>That's the set.</h2>
          <ul class="counts">
            <li><b>${model.counts.again}</b><span>Again</span></li>
            <li><b>${model.counts.hard}</b><span>Hard</span></li>
            <li><b>${model.counts.good}</b><span>Good</span></li>
            <li><b>${model.counts.easy}</b><span>Easy</span></li>
          </ul>
          ${upcoming}
          <p><a href="#/">Back home</a></p>
        </div>
      </div>
    </section>`;
  }
  const card = model.card;
  const french = formatFrench(card);
  const picture = `<div class="pic"><img src="${escapeHtml(iconUrl(card.icon))}" alt="" data-fallback="${escapeHtml(french.slice(0, 1))}"></div>`;
  return `<section class="study">
    <header class="study-top">
      <button class="close" type="button" data-action="close" aria-label="Close">×</button>
      <div class="study-meta">
        <p>${model.left} left</p>
        <span class="chip">${escapeHtml(topicLabel(card.topic))}</span>
      </div>
    </header>
    <div class="stage">
      <div class="flip ${model.flipped ? 'is-flipped' : ''}">
        <div class="flip-inner">
          <div class="face front" data-action="flip" role="button" tabindex="0" aria-label="Card front. ${escapeHtml(french)}. Activate to flip.">
            ${picture}
            <p class="french" lang="fr" translate="no">${escapeHtml(french)}</p>
            <p class="tap-hint">Tap to flip</p>
          </div>
          <div class="face back" data-action="flip" role="button" tabindex="-1" aria-hidden="true" aria-label="Card back. Activate to flip.">
            <p class="gloss-label">English</p>
            <p class="english">${escapeHtml(card.english)}</p>
            <p class="example" lang="fr" translate="no">${escapeHtml(card.example)}</p>
            <p class="example-en">${escapeHtml(card.exampleEn)}</p>
            ${card.note ? `<p class="missed">${escapeHtml(card.note)}</p>` : ''}
            ${model.lapses > 0 ? `<p class="missed">Missed ${model.lapses} time${model.lapses === 1 ? '' : 's'}</p>` : ''}
          </div>
        </div>
      </div>
    </div>
    <div class="audio-row">
      <button type="button" data-action="speak" data-which="word">Hear it</button>
      <button type="button" data-action="speak" data-which="example" ${model.flipped ? '' : 'hidden'}>Hear the example</button>
    </div>
    <div class="grades" ${model.flipped ? '' : 'hidden'}>
      ${gradeButton('again', 'Again', model.previews.again)}
      ${gradeButton('hard', 'Hard', model.previews.hard)}
      ${gradeButton('good', 'Good', model.previews.good)}
      ${gradeButton('easy', 'Easy', model.previews.easy)}
    </div>
    <p class="kbd">Space flips · 1 Again · 2 Hard · 3 Good · 4 Easy</p>
    <p class="sr-only" aria-live="polite">${escapeHtml(french)}</p>
  </section>`;
}

function gradeButton(grade: Grade, label: string, when: string): string {
  return `<button type="button" class="${grade}" data-action="grade" data-grade="${grade}"><span class="name">${label}</span><span class="when">${escapeHtml(when)}</span></button>`;
}

export function renderTricky(rows: TrickyRow[]): string {
  const body = rows.length
    ? rows
        .map(
          (row) => `<article class="tricky-row">
            <img src="${escapeHtml(iconUrl(row.card.icon))}" alt="">
            <div>
              <strong lang="fr" translate="no">${escapeHtml(formatFrench(row.card))}</strong>
              <p>${escapeHtml(row.card.english)}</p>
            </div>
            <span class="lapses">${row.lapses}</span>
          </article>`,
        )
        .join('')
    : `<p class="quiet">No tricky cards yet. They show up when you press Again.</p>`;
  return `<main class="screen">
    <p class="eyebrow">Lapses</p>
    <h1>Tricky cards</h1>
    <p class="lede">The words that slipped, most often first.</p>
    ${rows.length ? `<button class="btn primary" type="button" data-action="export-tricky" style="margin-top:18px">Export JSON</button>` : ''}
    <div style="margin-top:12px">${body}</div>
  </main>${tabbar('tricky')}`;
}

export function renderSettings(model: SettingsModel): string {
  const sync = model.configured
    ? authBlock(model)
    : `<div class="note">Progress stays on this phone. To sync with your computer, add a free Supabase project. The steps are in the README. Nothing is sent anywhere until that file is filled in.</div>`;
  return `<main class="screen">
    <p class="eyebrow">Réglages</p>
    <h1>Settings</h1>
    <div class="setting">
      <div>
        <strong>New cards a day</strong>
        <p>Reviews that are due are always included. Applies when you next start Study.</p>
      </div>
      <div class="stepper">
        <button type="button" data-action="new-dec" aria-label="Fewer new cards">−</button>
        <strong>${model.settings.newPerDay}</strong>
        <button type="button" data-action="new-inc" aria-label="More new cards">+</button>
      </div>
    </div>
    <div class="setting">
      <div>
        <strong>Speak on flip</strong>
        <p>Play the French when the answer turns over. A French voice is used when the phone has one.</p>
      </div>
      <button class="switch" type="button" role="switch" aria-checked="${model.settings.autoplay}" aria-label="Speak French when you flip a card" data-action="toggle-autoplay"></button>
    </div>
    <h2 class="section-title">Sync</h2>
    ${sync}
    <p class="credits">Emoji by <a href="https://github.com/jdecked/twemoji">Twemoji</a>, © Twitter, Inc. and other contributors, <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Number, weekday, and a few household icons are original. Type is Fraunces and Source Sans 3, SIL Open Font License.</p>
  </main>${tabbar('settings')}`;
}

function authBlock(model: SettingsModel): string {
  if (model.email) {
    return `<div class="note">
      <p>Signed in as ${escapeHtml(model.email)}.</p>
      <div class="btn-row">
        <button class="btn primary" type="button" data-action="sync" ${model.busy ? 'disabled' : ''}>Sync now</button>
        <button class="btn ghost" type="button" data-action="sign-out" ${model.busy ? 'disabled' : ''}>Sign out</button>
      </div>
      <p class="auth-msg">${escapeHtml(model.message)}</p>
    </div>`;
  }
  return `<form data-action="auth-form">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="username" inputmode="email" required>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" minlength="8" required>
    <div class="btn-row">
      <button class="btn primary" type="button" data-action="sign-in" ${model.busy ? 'disabled' : ''}>Sign in</button>
      <button class="btn ghost" type="button" data-action="sign-up" ${model.busy ? 'disabled' : ''}>Create account</button>
    </div>
    <div class="btn-row">
      <button class="btn ghost" type="button" data-action="magic-link" ${model.busy ? 'disabled' : ''}>Email me a link instead</button>
    </div>
    <p class="quiet">On iPhone, sign in inside the home-screen app. A magic link opens Safari, which does not share its login with the installed app.</p>
    <p class="auth-msg">${escapeHtml(model.message)}</p>
  </form>`;
}
