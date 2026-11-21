# Testament Quest: design and setup

A gamified daily scripture-reading habit, built as a module of the WCG Study PWA at `/quest/`.

## 1. Architecture

```
┌─────────────── Client: installable PWA (iOS, Android, desktop) ───────────────┐
│ quest/index.html  →  js/app.js (UI)                                            │
│                       ├─ js/engine.js     pure rules: streaks, tiers, quests,  │
│                       │                   bosses, sanctuary, monument, ranking │
│                       ├─ js/store.js      localStorage + Supabase REST adapter │
│                       ├─ js/sanctuary.js  SVG sanctuary + monument             │
│                       ├─ js/links.js      wol.jw.org / jw.org link builders    │
│                       └─ js/data/         66 books, John quiz bank, lore       │
└───────────────┬──────────────────────────────────────┬────────────────────────┘
                │ REST + RPC (user JWT, RLS)           │ fetch
┌───────────────▼──────────────┐        ┌──────────────▼───────────────────────┐
│ Supabase Postgres            │        │ Netlify Functions                    │
│ db/schema.sql                │◄───────┤ quest-quiz      AI quiz, CDN-cached  │
│  log_reading()  ← all streak │ service│ encourage-cron  hourly 7 pm nudges   │
│  and unlock rules live here  │  key   │ encourage-send  friend → friend      │
│  RLS on every table          │        │ telegram        signed link + webhook│
└──────────────────────────────┘        └──────────────────────────────────────┘
```

**Offline-first.** The full solo game (streaks, quizzes, sanctuary, quests, bosses, artifacts) runs from `localStorage` with no server at all. Signing in to a congregation server adds pooling, the leaderboard and automated messaging. In that mode the server is authoritative for streak numbers.

**One rulebook, two runtimes.** `engine.js` and `log_reading()` implement the same rules. `tests/engine.test.mjs` covers the JS side and `db/test.sql` the SQL side. `scripts/gen-seed.mjs` generates `db/seed.sql` from the JS data, so books, quest order, artifacts and bosses cannot drift apart.

## 2. Data model (db/schema.sql)

| Table | Purpose |
|---|---|
| `profiles` | `current_streak`, `longest_streak`, `total_days_read`, `streak_shields`, `last_read_day`, `tier_id` → milestones, time zone, messaging opt-in |
| `milestones` | Foundation 7 / Growth 30 / Mastery 90, each mapped to a sanctuary stage |
| `books` | 66 books with `quest_order` (the campaign path) and `section` (boss arcs) |
| `reading_logs` | One row per passed chapter per day, with the quiz score |
| `chapter_progress` | First completion of each chapter, which drives unlocks |
| `artifacts` / `user_artifacts` | One collectible per book, awarded on completion |
| `bosses` / `boss_victories` | One lore battle per section; gates the next section |
| `congregations` / `congregation_members` | Groups joined by a 6-character invite code |
| `friendships` | Pending/accepted friend links |
| `encouragements` | Outbox and audit log; a unique index enforces 1 message per sender → recipient per channel per day |
| Views | `congregation_monument`, `fellowship_leaderboard`, `encouragement_candidates` |

Clients cannot write counters, progress or artifacts. Column-level grants allow only name, time zone and messaging fields, and every game write goes through `SECURITY DEFINER` RPCs. The reading day is computed from the **server clock** in the reader's time zone, so changing the device clock cannot backdate a reading.

## 3. Game rules (decisions and why)

- **A day counts** when at least one chapter passes its quiz (2 of 3 correct). Failing shows the verses to review and allows a retry. Re-reading a finished chapter still counts for the streak but adds no progress.
- **Streak shields (grace).** One shield is earned every 7 consecutive days, up to 2 held. A shield automatically covers a single missed day. *Why:* streak apps that punish one miss drive churn and guilt; one forgiven day keeps the habit going without making the streak meaningless. Two missed days still reset.
- **Tier comes from the best streak, not the current one.** Foundation, Growth and Mastery are never taken away. The current streak controls the sanctuary's **light**: 7 lamps, lit from the centre out, at full brightness from day 7. The sky shows the day's status: day = read today, dusk = at risk, night = lapsed. *Why:* losing 89 days of earned structure over one bad week would be demoralizing. A dimmed sanctuary still makes a lapse visible and recoverable.
- **Quest path.** John comes first (the onboarding quest, with an offline hand-written quiz bank), then the rest of the Christian Greek Scriptures in canonical order, then Genesis → Malachi. To change the route, edit `QUEST_ORDER` in `js/data/books.js` and rerun `npm run seed`.
- **Bosses.** The last book of each section on the path triggers a 4-question lore battle (10 sections). Winning needs 3 of 4 and unlocks the next section.
- **Quizzes outside John** come from `quest-quiz` (Claude, with model, prompt and JSON schema fixed server-side). The CDN caches each result per chapter, so each chapter costs one model call in total, not one per reader. If the endpoint is unreachable, the reader writes a one-sentence reflection instead, so progress is never blocked.
- **Leaderboard** ranks by *days read this week*, then live streak. *Why:* ranking by chapters would reward binge-reading, which works against the daily habit.
- **Monument.** A congregation pools every passed chapter its members log after joining. The goal is the whole Bible (1,189 chapters × `goal_laps`), built in 6 stages: Cleared ground → Foundation stones → Pillars → Roof → Lampstand → Complete.

## 4. Encouragement to messaging apps: what is actually possible

| Channel | Automated? | How |
|---|---|---|
| Telegram | **Yes** | The reader opens a signed `t.me/<bot>?start=…` link from the app once; the webhook stores their chat id. After that, the 7 pm nudges and friend encouragements are sent by the bot. `/stop` unlinks. |
| WhatsApp | **Yes, with a business number** | WhatsApp Cloud API. Meta allows business-initiated messages only through a **pre-approved template**, so free text is impossible. Register a template whose body uses `{{1}}` (sender) and `{{2}}` (streak days). Each conversation is billed by Meta. |
| WhatsApp / SMS / iMessage from the user's own account | **One tap, not automatic** | `wa.me`, `sms:` and the native share sheet with a prefilled message. No platform lets a third-party app send from a user's personal account silently. |

Every automated message needs the recipient's opt-in (`encourage_opt_in`), and at most one message per sender per recipient per day is sent.

## 5. Setup

**Solo/offline mode:** nothing to do. Deploy the site and open `/quest/`.

**Congregation mode:**
1. Create a Supabase project. In the SQL editor, run `db/schema.sql`, then `db/seed.sql`. Do **not** run `db/supabase-shim.sql`; it exists only for local tests.
2. Auth → URL configuration: add `https://<your-site>/quest/` as a redirect URL. Email magic links are enabled by default.
3. Put the project URL and **anon** key in `quest/config.js`.
4. In Netlify, set these environment variables:
   - `ANTHROPIC_API_KEY` for AI quizzes outside John.
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the encouragement functions. These are server-side only.
   - Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, then
     `curl "https://api.telegram.org/bot$TOKEN/setWebhook?url=https://<site>/.netlify/functions/telegram&secret_token=$SECRET"`
   - WhatsApp (optional): `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TEMPLATE`, `WHATSAPP_TEMPLATE_LANG`
5. `encourage-cron` runs hourly via `netlify.toml` and messages each opted-in reader at 7 pm in their own time zone.
6. On every deploy that changes `/quest/` files, bump `CACHE_NAME` in `sw.js`. The service worker serves app files cache-first.

## 6. Tests

```
npm test            # engine + functions (node:test, no network)
npm run test:e2e    # Chromium walkthrough via Playwright
npm run test:db     # against a Postgres 15+ database (PG* env vars): shim + schema + seed + assertions incl. RLS
```

## 7. Known limitations and next steps

- **Quiz scores are self-reported.** The client grades the quiz and the server checks only that the score passes. A determined user could call the RPC directly. This is acceptable for a personal-accountability app, but the leaderboard should not carry prizes. To harden it, move grading server-side by storing answer keys in the database.
- **Pooled reading counts re-reads.** This is deliberate, since the monument measures reading together, but one member can contribute heavily. Use `distinct (user, book, chapter)` in the view if a group prefers unique coverage.
- **Friend requests have RLS and tables but no UI yet.** Congregation membership already creates the Fellowship, so friend requests are optional. Personal friends outside a congregation are handled through one-tap sharing.
- **jw.org video links use jw.org site search** ("Introduction to <Book>"). I could not reach jw.org from the build environment, so I could not pin direct video URLs. Search is stable but adds one tap.
- **Native app stores.** The PWA already installs on iOS, Android and desktop. Wrapping it with Capacitor would add store distribution and native push. The web push channel (`push` in `encouragements.channel`) is reserved for that.
- `netlify/functions/claude.js` (pre-existing) is an **open pass-through proxy** to the Anthropic API: anyone can send it any request, billed to this account. It is not used by Testament Quest; consider locking it down (fixed model and prompt, origin check, rate limit) the way `quest-quiz` is.
