import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../quest/js/engine.js';
import { JOHN_QUIZ } from '../quest/js/data/quiz-john.js';
import { ARTIFACTS, BOSSES } from '../quest/js/data/lore.js';

const run = (days) => days.reduce((s, d) => E.applyReadingDay(s, d).streak, E.emptyStreak());

test('dayKey respects the reader time zone', () => {
  const instant = new Date('2026-11-21T03:30:00Z');
  assert.equal(E.dayKey(instant, 'UTC'), '2026-11-21');
  assert.equal(E.dayKey(instant, 'America/New_York'), '2026-11-20');
  assert.equal(E.dayKey(instant, 'Asia/Tokyo'), '2026-11-21');
});

test('date math crosses month, year and DST boundaries', () => {
  assert.equal(E.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(E.daysBetween('2026-03-07', '2026-03-09'), 2);
  assert.equal(E.daysBetween('2028-02-28', '2028-03-01'), 2);
});

test('consecutive days extend the streak; same day is idempotent', () => {
  let r = E.applyReadingDay(E.emptyStreak(), '2026-11-01');
  assert.equal(r.event, 'started');
  r = E.applyReadingDay(r.streak, '2026-11-01');
  assert.equal(r.event, 'same-day');
  assert.equal(r.streak.totalDays, 1);
  r = E.applyReadingDay(r.streak, '2026-11-02');
  assert.deepEqual([r.event, r.streak.current, r.streak.totalDays], ['extended', 2, 2]);
});

test('a single missed day consumes a shield earned at day 7', () => {
  const days = Array.from({ length: 7 }, (_, i) => E.addDays('2026-11-01', i));
  let s = run(days);
  assert.equal(s.shields, 1);
  const r = E.applyReadingDay(s, E.addDays('2026-11-07', 2));
  assert.deepEqual([r.event, r.streak.current, r.streak.shields], ['shield-used', 8, 0]);
});

test('a miss without shields, or two misses, resets to 1 but keeps longest and total', () => {
  let s = run(['2026-11-01', '2026-11-02', '2026-11-03']);
  let r = E.applyReadingDay(s, '2026-11-05');
  assert.deepEqual([r.event, r.streak.current, r.streak.longest, r.streak.totalDays], ['reset', 1, 3, 4]);
  s = run(Array.from({ length: 7 }, (_, i) => E.addDays('2026-11-01', i)));
  r = E.applyReadingDay(s, E.addDays('2026-11-07', 3));
  assert.equal(r.event, 'reset');
});

test('backdated logs are ignored', () => {
  const s = run(['2026-11-05']);
  assert.equal(E.applyReadingDay(s, '2026-11-04').event, 'past-day');
});

test('shields cap at MAX_SHIELDS', () => {
  const s = run(Array.from({ length: 35 }, (_, i) => E.addDays('2026-01-01', i)));
  assert.equal(s.shields, E.MAX_SHIELDS);
});

test('liveStreak shows 0 once a streak is unrecoverable', () => {
  const s = run(['2026-11-01', '2026-11-02']);
  assert.equal(E.liveStreak(s, '2026-11-03'), 2);
  assert.equal(E.streakAtRisk(s, '2026-11-03'), true);
  assert.equal(E.liveStreak(s, '2026-11-04'), 0);
});

test('tiers follow Foundation 7 / Growth 30 / Mastery 90 on longest streak', () => {
  assert.equal(E.tierFor(6), null);
  assert.equal(E.tierFor(7).code, 'foundation');
  assert.equal(E.tierFor(29).code, 'foundation');
  assert.equal(E.tierFor(30).code, 'growth');
  assert.equal(E.tierFor(90).code, 'mastery');
  assert.equal(E.nextMilestone(10).code, 'growth');
  assert.equal(E.nextMilestone(90), null);
});

test('sanctuary keeps structure after a lapse but dims its lamps', () => {
  const s = run(Array.from({ length: 8 }, (_, i) => E.addDays('2026-11-01', i)));
  const lit = E.sanctuaryState({ streak: s, today: '2026-11-08' });
  assert.deepEqual([lit.stage, lit.tier, lit.lampsLit, lit.readToday], [1, 'foundation', 7, true]);
  const dim = E.sanctuaryState({ streak: s, today: '2026-11-20' });
  assert.deepEqual([dim.stage, dim.lampsLit], [1, 0]);
  assert.equal(dim.next.code, 'growth');
  assert.equal(dim.next.remaining, 22);
});

test('quiz passes at 2 of 3', () => {
  const qs = JOHN_QUIZ[1];
  assert.equal(E.gradeQuiz(qs, [0, 1, 3]).passed, true);
  assert.equal(E.gradeQuiz(qs, [0, 0, 3]).passed, false);
});

test('John quiz bank covers all 21 chapters with valid answers', () => {
  for (let c = 1; c <= 21; c++) {
    assert.ok(JOHN_QUIZ[c]?.length >= 3, `chapter ${c}`);
    for (const q of JOHN_QUIZ[c]) {
      assert.equal(q.options.length, 4);
      assert.ok(q.a >= 0 && q.a < 4);
      assert.match(q.ref, /^John /);
    }
  }
});

test('quest starts with John; everything else is locked', () => {
  const board = E.questBoard(E.emptyProgress());
  assert.equal(board[0].name, 'John');
  assert.equal(board[0].status, 'active');
  assert.ok(board.slice(1).every(b => b.status === 'locked'));
});

test('completing John unlocks Matthew; locked books reject logs', () => {
  let p = E.emptyProgress();
  assert.throws(() => E.completeChapter(p, 40, 1), /locked/);
  let r;
  for (let c = 1; c <= 21; c++) { r = E.completeChapter(p, 43, c); p = r.progress; }
  assert.equal(r.bookCompleted, true);
  assert.equal(r.unlocked, 40);
  assert.equal(E.activeBook(p).name, 'Matthew');
  assert.equal(E.completeChapter(p, 43, 3).newChapter, false);
});

test('section finale gates the next book behind a boss battle', () => {
  let p = E.emptyProgress();
  for (const num of [43, 40, 41, 42]) {
    for (let c = 1; c <= E.BOOK_BY_NUM[num].chapters; c++) p = E.completeChapter(p, num, c).progress;
  }
  assert.equal(E.pendingBoss(p).section, 'Gospels');
  assert.equal(E.activeBook(p), null);
  p = E.defeatBoss(p, 'Gospels');
  assert.equal(E.activeBook(p).name, 'Acts');
  assert.equal(E.pendingBoss(p), null);
});

test('every section has a boss and every book an artifact', () => {
  const sections = new Set(E.BOOKS.map(b => b.section));
  for (const s of sections) {
    assert.ok(BOSSES[s]?.questions.length >= 4, s);
    for (const q of BOSSES[s].questions) assert.ok(q.a >= 0 && q.a < q.options.length);
  }
  for (const b of E.BOOKS) assert.ok(ARTIFACTS[b.num]?.name, b.name);
  assert.equal(E.QUEST_ORDER.filter(E.isSectionFinale).length, sections.size);
});

test('monument stages scale with pooled chapters', () => {
  assert.equal(E.monumentState(0).name, 'Cleared ground');
  assert.equal(E.monumentState(60).name, 'Foundation stones');
  assert.equal(E.monumentState(1189).name, 'Monument complete');
  assert.equal(E.monumentState(1189).next, null);
  assert.equal(E.monumentState(100).next.name, 'Pillars raised');
});

test('leaderboard ranks consistency over volume', () => {
  const today = '2026-11-21';
  const week = Array.from({ length: 7 }, (_, i) => E.addDays(today, -i));
  const rows = E.leaderboard([
    { name: 'Binge', streak: run([today]), recentDays: [today] },
    { name: 'Daily', streak: run([...week].reverse()), recentDays: week },
  ], today);
  assert.deepEqual(rows.map(r => r.name), ['Daily', 'Binge']);
  assert.equal(rows[0].weekDays, 7);
});

test('share links encode the message for each messaging app', () => {
  const text = E.encouragementText({ fromName: 'Ama', toName: 'Kofi', streak: 12, bookName: 'John' });
  assert.match(text, /12-day/);
  const l = E.shareLinks(text);
  assert.ok(l.whatsapp.startsWith('https://wa.me/?text=Hi%20Kofi'));
  assert.ok(l.sms.startsWith('sms:'));
});
