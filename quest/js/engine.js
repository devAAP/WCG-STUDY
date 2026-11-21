// Testament Quest — pure game engine. No DOM, no storage, no network.
// Every function takes plain state and returns new values, so the same module
// runs in the browser, in Netlify functions, and under `node --test`.
import { BOOKS, BOOK_BY_NUM, QUEST_ORDER, TOTAL_CHAPTERS } from './data/books.js';

// ── Milestones (mirrors the `milestones` table in db/schema.sql) ──────────
export const MILESTONES = [
  { code: 'foundation', name: 'Foundation', days: 7,  sanctuary: 'Stone foundation laid' },
  { code: 'growth',     name: 'Growth',     days: 30, sanctuary: 'Walls, garden and courtyard' },
  { code: 'mastery',    name: 'Mastery',    days: 90, sanctuary: 'Completed sanctuary with lampstand' },
];

export const QUIZ_PASS_RATIO = 2 / 3;   // 2 of 3 correct
export const SHIELD_EVERY = 7;          // earn a streak shield every 7 consecutive days
export const MAX_SHIELDS = 2;

// ── Day keys ──────────────────────────────────────────────────────────────
// A "day" is a calendar date in the reader's own time zone, as 'YYYY-MM-DD'.
export function dayKey(date = new Date(), timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const toUTC = k => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
export const addDays = (k, n) => new Date(toUTC(k) + n * 86400000).toISOString().slice(0, 10);

// ── Streaks ───────────────────────────────────────────────────────────────
// Streak state: { current, longest, totalDays, lastDay, shields }.
// A missed single day is forgiven automatically if a shield is available
// (grace beats guilt for a spiritual habit). Two+ missed days, or a miss with
// no shield, resets the streak to 1 on the next reading.
export function emptyStreak() {
  return { current: 0, longest: 0, totalDays: 0, lastDay: null, shields: 0 };
}

export function applyReadingDay(streak, today) {
  const s = { ...streak };
  if (s.lastDay === today) return { streak: s, event: 'same-day' };
  if (s.lastDay && daysBetween(s.lastDay, today) < 0) return { streak: s, event: 'past-day' };

  let event;
  const gap = s.lastDay ? daysBetween(s.lastDay, today) : null;
  if (gap === null) { s.current = 1; event = 'started'; }
  else if (gap === 1) { s.current += 1; event = 'extended'; }
  else if (gap === 2 && s.shields > 0) { s.shields -= 1; s.current += 1; event = 'shield-used'; }
  else { s.current = 1; event = 'reset'; }

  s.totalDays += 1;
  s.lastDay = today;
  s.longest = Math.max(s.longest, s.current);
  if (s.current % SHIELD_EVERY === 0 && s.shields < MAX_SHIELDS) s.shields += 1;
  return { streak: s, event };
}

// What the streak looks like *today* without logging anything: a streak whose
// last day is beyond recovery displays as 0 so the UI and leaderboard are honest.
export function liveStreak(streak, today) {
  if (!streak.lastDay) return 0;
  const gap = daysBetween(streak.lastDay, today);
  if (gap <= 1) return streak.current;
  if (gap === 2 && streak.shields > 0) return streak.current; // still savable today
  return 0;
}

export function streakAtRisk(streak, today) {
  if (!streak.lastDay) return false;
  const gap = daysBetween(streak.lastDay, today);
  return gap === 1 || (gap === 2 && streak.shields > 0);
}

// ── Tiers ─────────────────────────────────────────────────────────────────
// Tier is earned from the *longest* streak, so a missed day never demotes the
// sanctuary's structure; the *current* streak drives its light (vitality).
export function tierFor(longest) {
  let tier = null;
  for (const m of MILESTONES) if (longest >= m.days) tier = m;
  return tier;
}

export function nextMilestone(longest) {
  return MILESTONES.find(m => longest < m.days) || null;
}

// ── Sanctuary ─────────────────────────────────────────────────────────────
// Structure stage 0–3 from tier; vitality 0–1 from current streak (glows fully
// at 7+ days, dims as the streak lapses). Artifacts are placed on display.
export function sanctuaryState({ streak, today, artifacts = [] }) {
  const tier = tierFor(streak.longest);
  const stage = tier ? MILESTONES.indexOf(tier) + 1 : 0;
  const live = liveStreak(streak, today);
  const vitality = Math.min(1, live / 7);
  const next = nextMilestone(streak.longest);
  return {
    stage,
    tier: tier ? tier.code : 'seeker',
    tierName: tier ? tier.name : 'Seeker',
    vitality,
    lampsLit: Math.round(vitality * 7),
    atRisk: streakAtRisk(streak, today) && streak.lastDay !== today,
    readToday: streak.lastDay === today,
    next: next && { ...next, remaining: next.days - streak.longest },
    artifacts,
  };
}

// ── Quiz ──────────────────────────────────────────────────────────────────
export function gradeQuiz(questions, answers) {
  const correct = questions.reduce((n, q, i) => n + (answers[i] === q.a ? 1 : 0), 0);
  return { correct, total: questions.length, passed: correct / questions.length >= QUIZ_PASS_RATIO - 1e-9 };
}

// ── Quests ────────────────────────────────────────────────────────────────
// Progress: { chapters: { [bookNum]: number[] }, bossesDefeated: string[] }.
export function emptyProgress() { return { chapters: {}, bossesDefeated: [] }; }

export const isBookComplete = (progress, num) =>
  (progress.chapters[num] || []).length >= BOOK_BY_NUM[num].chapters;

// A book is a section finale if it is the last book of its section on the quest path.
export function isSectionFinale(num) {
  const sec = BOOK_BY_NUM[num].section;
  const inSection = QUEST_ORDER.filter(n => BOOK_BY_NUM[n].section === sec);
  return inSection[inSection.length - 1] === num;
}

export function bossForBook(num) {
  return isSectionFinale(num) ? BOOK_BY_NUM[num].section : null;
}

// Walk the quest path: each book unlocks once the previous one is complete and,
// if that previous book closed a section, its boss has been defeated.
export function questBoard(progress) {
  const board = [];
  let open = true;
  for (const num of QUEST_ORDER) {
    const book = BOOK_BY_NUM[num];
    const done = (progress.chapters[num] || []).length;
    const complete = done >= book.chapters;
    const boss = bossForBook(num);
    const bossDefeated = boss ? progress.bossesDefeated.includes(boss) : true;
    const status = !open ? 'locked' : complete ? 'complete' : 'active';
    board.push({ ...book, done, status, boss, bossReady: complete && !bossDefeated && open, bossDefeated });
    if (!(open && complete && bossDefeated)) open = false;
  }
  return board;
}

export function activeBook(progress) {
  const board = questBoard(progress);
  return board.find(b => b.status === 'active') || null;
}

export function pendingBoss(progress) {
  return questBoard(progress).find(b => b.bossReady) || null;
}

// Record a passed chapter. Returns what changed so the UI can celebrate.
export function completeChapter(progress, num, chapter) {
  const board = questBoard(progress);
  const entry = board.find(b => b.num === num);
  // Completed books stay open for review reading (counts for the streak, adds no progress).
  if (!entry || entry.status === 'locked') throw new Error(`${BOOK_BY_NUM[num]?.name ?? num} is locked`);
  if (chapter < 1 || chapter > entry.chapters) throw new Error('Chapter out of range');
  const list = progress.chapters[num] || [];
  if (list.includes(chapter)) return { progress, newChapter: false, bookCompleted: false, unlocked: null, boss: null };
  const next = { ...progress, chapters: { ...progress.chapters, [num]: [...list, chapter].sort((a, b) => a - b) } };
  const bookCompleted = isBookComplete(next, num);
  const after = questBoard(next);
  const unlockedEntry = bookCompleted ? after.find(b => b.status === 'active' && b.num !== num) : null;
  return {
    progress: next, newChapter: true, bookCompleted,
    unlocked: unlockedEntry ? unlockedEntry.num : null,
    boss: bookCompleted ? bossForBook(num) : null,
  };
}

export function defeatBoss(progress, section) {
  if (progress.bossesDefeated.includes(section)) return progress;
  return { ...progress, bossesDefeated: [...progress.bossesDefeated, section] };
}

export function nextUnreadChapter(progress, num) {
  const read = new Set(progress.chapters[num] || []);
  for (let c = 1; c <= BOOK_BY_NUM[num].chapters; c++) if (!read.has(c)) return c;
  return null;
}

export function bibleProgress(progress) {
  const read = Object.values(progress.chapters).reduce((s, l) => s + l.length, 0);
  return { read, total: TOTAL_CHAPTERS, pct: read / TOTAL_CHAPTERS };
}

// ── Congregation monument ─────────────────────────────────────────────────
// The congregation's shared goal is reading the whole Bible together (1,189
// chapters, pooled). Stages unlock at fixed fractions of that goal.
export const MONUMENT_STAGES = [
  { at: 0,    name: 'Cleared ground' },
  { at: 0.05, name: 'Foundation stones' },
  { at: 0.15, name: 'Pillars raised' },
  { at: 0.35, name: 'Roof beams set' },
  { at: 0.60, name: 'Lampstand placed' },
  { at: 1.00, name: 'Monument complete' },
];

export function monumentState(pooledChapters, laps = 1) {
  const goal = TOTAL_CHAPTERS * laps;
  const pct = Math.min(1, pooledChapters / goal);
  let idx = 0;
  MONUMENT_STAGES.forEach((s, i) => { if (pct >= s.at) idx = i; });
  const next = MONUMENT_STAGES[idx + 1];
  return {
    stage: idx, name: MONUMENT_STAGES[idx].name, pct, pooled: pooledChapters, goal,
    next: next ? { name: next.name, remaining: Math.ceil(next.at * goal - pooledChapters) } : null,
  };
}

// ── Fellowship leaderboard ────────────────────────────────────────────────
// Ranked by days read in the last 7 days (consistency, not volume — reading
// 20 chapters in one sitting should not beat daily faithfulness), then live
// streak, then name for stable ordering.
export function leaderboard(members, today) {
  return members
    .map(m => ({
      ...m,
      liveStreak: liveStreak(m.streak, today),
      weekDays: (m.recentDays || []).filter(d => { const g = daysBetween(d, today); return g >= 0 && g < 7; }).length,
    }))
    .sort((a, b) => b.weekDays - a.weekDays || b.liveStreak - a.liveStreak || a.name.localeCompare(b.name))
    .map((m, i) => ({ ...m, rank: i + 1 }));
}

// ── Encouragement ─────────────────────────────────────────────────────────
export function encouragementText({ fromName, toName, streak, bookName, appUrl }) {
  const s = streak > 0
    ? `your ${streak}-day reading streak is waiting for today’s chapter`
    : 'today is a great day to start a new reading streak';
  return `Hi ${toName}! ${fromName} here — ${s}${bookName ? ` in ${bookName}` : ''}. ` +
    `“Your word is a lamp to my foot.” (Psalm 119:105)${appUrl ? ` ${appUrl}` : ''}`;
}

export function shareLinks(text) {
  const t = encodeURIComponent(text);
  return {
    whatsapp: `https://wa.me/?text=${t}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(' ')}&text=${t}`,
    sms: `sms:?&body=${t}`,
    email: `mailto:?subject=${encodeURIComponent('Keep your reading streak going')}&body=${t}`,
  };
}

export { BOOKS, BOOK_BY_NUM, QUEST_ORDER, TOTAL_CHAPTERS };
