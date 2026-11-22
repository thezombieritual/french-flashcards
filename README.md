# Français

Spaced-repetition French for Paul: everyday family life now, CEFR B2 on the way to French nationality by marriage.

The site is a static app. It works on an iPhone and on a Mac, offline, with no account. Progress stays on the phone. When a free Supabase project is filled in, the same reviews sync between devices.

**Live site:** https://thezombieritual.github.io/french-flashcards/

## Study

Open the site in Safari. Tap the share button, then **Add to Home Screen**. The icon opens full screen, like an app, and works without a connection after the first load.

A session shows a picture and the French (nouns include *le, la, l', les*). Tap the card to flip it. The back has the English, an example, and **Hear it**, which speaks the French with a `fr-FR` voice when the phone has one. **Speak on flip** in Settings plays it automatically.

**Again**, **Hard**, **Good**, and **Easy** schedule the card. The label on each button is the next gap. **Again** brings the card back in the same session and counts a lapse. Ten new cards a day is the default; every card that is already due is included too. Change the daily number in Settings. It applies the next time you start Study.

The home screen shows how many cards are due, how many new cards are left today, and the streak (days in a row with at least one review; today still counts if you studied yesterday). **Tricky cards** lists the words you have missed, most often first, and can export them as JSON.

## On your computer

```bash
npm install
npm test
npm run dev
```

The dev site is http://localhost:5173/french-flashcards/ . The `/french-flashcards/` prefix is required so the built site matches GitHub Pages.

`npm run build` writes `dist/`. `npm run preview` serves that build.

## GitHub Pages

Pushes to `main` run `.github/workflows/pages.yml`. The workflow installs dependencies, runs the tests, builds the static site, and deploys it with GitHub Actions. No paid host, no analytics.

The repository owner has to turn Pages on once. If https://thezombieritual.github.io/french-flashcards/ is not loading:

1. Open https://github.com/thezombieritual/french-flashcards/settings/pages
2. Under **Build and deployment**, set **Source** to **GitHub Actions** (not “Deploy from a branch”).
3. If the Actions tab says workflows are disabled, open **Settings → Actions → General** and allow actions.
4. Open the **Actions** tab, choose **Deploy to GitHub Pages**, and run the workflow. A push to `main` also starts it.
5. If the deploy job waits for approval, open **Settings → Environments → github-pages** and allow it. Personal repositories usually do not ask.

When the workflow is green, the site is at https://thezombieritual.github.io/french-flashcards/

## Deck format

Decks are JSON files in `decks/`. `decks/index.json` lists the files to ship, in study order, plus decks that are planned and not written yet.

```json
{
  "id": "travel",
  "name": "Travel",
  "description": "Stations, tickets, and asking the way.",
  "level": "A2",
  "language": "fr",
  "cards": [
    {
      "id": "travel-gare",
      "topic": "stations",
      "french": "gare",
      "article": "la",
      "english": "train station",
      "example": "La gare est près d'ici.",
      "exampleEn": "The station is nearby.",
      "icon": "twemoji/1f686.svg",
      "note": "Optional. Shown in small type on the back."
    }
  ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Stable id for the whole app. Progress is stored under this id. Changing it resets that card. |
| `name`, `description`, `level` | yes | Shown on the home screen. |
| `language` | no | Informational. The app speaks French. |
| `cards[].id` | yes | Unique across every deck. |
| `topic` | yes | Short group name, shown on the card. |
| `french` | yes | The word or phrase, without the article. |
| `article` | yes | `le`, `la`, `l'`, `les`, or `null` for a phrase, verb, number, or greeting. |
| `english` | yes | The meaning. |
| `example`, `exampleEn` | yes | One short sentence and its English. |
| `icon` | yes | Path under `public/icons/`, for example `twemoji/1f686.svg` or `custom/table.svg`. |
| `note` | no | A warning such as a feminine form. |

To add a deck:

1. Add `decks/your-deck.json`.
2. Put its filename in the `files` array of `decks/index.json`.
3. Add one SVG per new picture under `public/icons/` and commit it. Do not hotlink.
4. Push to `main`. Pages rebuilds the site.

Nouns that start with a vowel or a mute *h* use `l'`, not `le` or `la`. The tests check that, and that every icon file exists.

The starter deck is `family-life`: greetings and politeness, people, family, the house, food and meals, numbers, days, time, basic verbs, and a few phrases you actually say at home. Later decks, already named on the home screen and in `decks/index.json`, are travel, health, work, French civic life, and a B2 core.

## Scheduling

The scheduler is SM-2 with four grades.

- **Good** on a new card is due tomorrow, then in 6 days, then after `interval × ease` (ease starts at 2.5).
- **Easy** jumps to 4 days.
- **Hard** on a new card comes back in 10 minutes. On a review card the interval grows by 1.2.
- **Again** resets the ladder, lowers ease (never below 1.3), adds a lapse, and shows the card again in the same session.

Review dates are local midnights, so a card due “in 1 day” is there the next morning. The streak is the run of days with at least one review, including today. If you have not studied today, yesterday’s streak still shows until the day is over.

## Supabase

Sync is optional. With `src/config.ts` left blank, the app never contacts Supabase. Reviews are stored in IndexedDB (and mirrored to localStorage if IndexedDB is unavailable).

When you do want the phone and the computer to share progress:

1. Create a free project at https://supabase.com/dashboard
2. Open the SQL editor and run `supabase/migrations/001_init.sql`.
3. In **Project Settings → API**, copy the project URL and the **anon** public key into `src/config.ts`:

   ```ts
   export const supabaseConfig = {
     url: 'https://YOUR-PROJECT.supabase.co',
     anonKey: 'YOUR-ANON-KEY',
   };
   ```

   Use the anon key, not the service-role key. The anon key is meant to be in the website. Row-level security lets a signed-in person read and write only their own rows.
4. In **Authentication → URL configuration**, set the site URL and add this redirect URL: `https://thezombieritual.github.io/french-flashcards/`
   For local testing, also add `http://localhost:5173/french-flashcards/`
5. In **Authentication → Providers → Email**, leave email enabled. Turn **Confirm email** off if you want a password to work immediately inside the installed iPhone app. After your account exists, turn off new sign-ups so nobody else can create one.
6. Commit the config change and push to `main` so Pages rebuilds. The values are not secret, but they do have to be in the built site.
7. On the phone, open **Settings**, create the account or sign in, and tap **Sync now**.

Sign in with email and password from inside the home-screen app. A magic link opens Safari, and iOS does not share that login with the installed app. The link is still there if you prefer to study in Safari.

If the phone is offline, the review is saved locally and sent the next time you are online and signed in. If two devices reviewed the same card, the review with the later timestamp wins, and that whole schedule is kept. Review dates from both devices still count toward the streak.

## Privacy

There is no analytics and no third-party tracker. Pictures, fonts, and decks are part of the site. French audio uses the browser speech API on the device. The only network account is Supabase, and only after you fill in the config and sign in.

## Credits

Emoji art is [Twemoji](https://github.com/jdecked/twemoji), © Twitter, Inc. and other contributors, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The files in `public/icons/twemoji/` are unmodified. The license text is beside them.

Number, weekday, and a few household pictures (table, stairs, fridge, oven, sink, sugar, balcony) were drawn for this app and are in the public domain.

Fraunces and Source Sans 3 are used under the SIL Open Font License. The license texts are in `public/fonts/`.
