// Testament Quest — UI controller.
import * as E from './engine.js';
import { JOHN_QUIZ } from './data/quiz-john.js';
import { ARTIFACTS, BOSSES } from './data/lore.js';
import { studyChapterUrl, verseUrl, dailyTextUrl, bookVideoUrl } from './links.js';
import { renderSanctuary, renderMonument } from './sanctuary.js';
import * as S from './store.js';

let state = S.load();
const ui = { tab: 'today', book: null, chapter: null, modal: null, fellowship: null, busy: false };

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const persist = () => S.save(state);
const signedIn = () => S.remoteConfigured() && state.auth;
const shuffle = a => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200);
}

// ── Derived view state ─────────────────────────────────────────────────────
function currentBook() {
  const board = E.questBoard(state.progress);
  const chosen = ui.book && board.find(b => b.num === ui.book && b.status !== 'locked');
  return chosen || board.find(b => b.status === 'active') || null;
}
function currentChapter(book) {
  if (ui.chapter && ui.book === book.num) return ui.chapter;
  return E.nextUnreadChapter(state.progress, book.num) || 1;
}
const sanctuary = () => E.sanctuaryState({ streak: state.streak, today: S.today(state), artifacts: state.artifacts });

// ── Rendering ──────────────────────────────────────────────────────────────
function render() {
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === ui.tab ? 'page' : 'false'));
  const view = { today: viewToday, quest: viewQuest, fellowship: viewFellowship, settings: viewSettings }[ui.tab];
  $('#view').innerHTML = view();
  $('#modal-root').innerHTML = ui.modal ? `<div class="backdrop" data-action="close-modal"></div><div class="modal" role="dialog" aria-modal="true">${ui.modal()}</div>` : '';
}

function viewToday() {
  const s = sanctuary();
  const today = S.today(state);
  const live = E.liveStreak(state.streak, today);
  const boss = E.pendingBoss(state.progress);
  const book = currentBook();
  const nextPct = s.next ? (state.streak.longest / s.next.days) * 100 : 100;
  const bp = E.bibleProgress(state.progress);

  const status = s.readToday ? '<span class="pill ok">✓ Read today</span>'
    : s.atRisk ? `<span class="pill warn">Read today to keep your ${live}-day streak${state.streak.shields && E.daysBetween(state.streak.lastDay, today) === 2 ? ' (a shield will cover yesterday)' : ''}</span>`
    : '<span class="pill">Start your streak today</span>';

  let reading;
  if (boss) {
    const b = BOSSES[boss.section];
    reading = `<section class="card boss-card"><h2>${b.icon} Boss battle: ${esc(b.name)}</h2>
      <p>You finished the <b>${esc(boss.section)}</b>. Win this lore challenge (3 of 4 correct) to unlock the next book.</p>
      <button class="btn primary" data-action="boss" data-section="${esc(boss.section)}">Begin the battle</button>
      <p class="muted small">Re-reading earlier books still counts for your streak — pick one in the Quest tab.</p></section>`;
  }
  if (book) {
    const ch = currentChapter(book);
    const done = (state.progress.chapters[book.num] || []).includes(ch);
    const options = Array.from({ length: book.chapters }, (_, i) => i + 1)
      .map(c => `<option value="${c}" ${c === ch ? 'selected' : ''}>${c}${(state.progress.chapters[book.num] || []).includes(c) ? ' ✓' : ''}</option>`).join('');
    reading = (reading || '') + `<section class="card">
      <div class="row between"><h2>Today’s reading</h2><span class="tag">${esc(book.section)}</span></div>
      <div class="chapter-pick"><span class="book-name">${esc(book.name)}</span>
        <label class="sr" for="ch">Chapter</label>
        <select id="ch" data-action="pick-chapter">${options}</select>
        ${done ? '<span class="pill">Review</span>' : ''}</div>
      <div class="links">
        <a class="link-btn" href="${studyChapterUrl(book.num, ch)}" target="_blank" rel="noopener">📖 Read ${esc(book.name)} ${ch} with study notes <small>wol.jw.org</small></a>
        <a class="link-btn" href="${dailyTextUrl(today)}" target="_blank" rel="noopener">🗓️ Today’s daily text <small>wol.jw.org</small></a>
        <a class="link-btn" href="${bookVideoUrl(book.name)}" target="_blank" rel="noopener">🎬 Introduction to ${esc(book.name)} video <small>jw.org</small></a>
      </div>
      <button class="btn primary big" data-action="quiz" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Preparing quiz…' : 'I’ve read it — take the 3-question quiz'}</button>
    </section>`;
  }
  if (!book && !boss) reading = `<section class="card"><h2>🌈 You have read the entire Bible!</h2><p>Every quest is complete. Keep your streak by re-reading any book from the Quest tab.</p></section>`;

  return `
    <section class="hero">${renderSanctuary(s)}
      <div class="hero-meta"><span class="tier tier-${s.tier}">${esc(s.tierName)}</span>${status}</div>
    </section>
    <section class="stats">
      <div><b>${live}</b><span>Current streak</span></div>
      <div><b>${state.streak.longest}</b><span>Best streak</span></div>
      <div><b>${state.streak.totalDays}</b><span>Total days</span></div>
      <div><b>${'🛡️'.repeat(state.streak.shields) || '—'}</b><span>Shields</span></div>
    </section>
    <section class="card slim">
      ${s.next ? `<div class="row between"><span>Next milestone: <b>${s.next.name}</b> (${s.next.days} days)</span><span class="muted">${s.next.remaining} to go</span></div>
        <div class="bar"><i style="width:${nextPct}%"></i></div><p class="muted small">Unlocks: ${esc(s.next.sanctuary)}. Milestones count your best streak, so a missed day never takes them away.</p>`
        : '<p>🏛️ <b>Mastery reached.</b> Your sanctuary is complete. Keep its lamps lit by reading daily.</p>'}
    </section>
    ${reading}
    <section class="card slim"><div class="row between"><span>Whole Bible</span><span class="muted">${bp.read} / ${bp.total} chapters</span></div>
      <div class="bar"><i style="width:${bp.pct * 100}%"></i></div></section>`;
}

function viewQuest() {
  const board = E.questBoard(state.progress);
  let lastTestament = '';
  const rows = board.map(b => {
    const art = ARTIFACTS[b.num];
    const head = b.testament !== lastTestament ? `<h3 class="testament">${esc(b.testament)} Quest</h3>` : '';
    lastTestament = b.testament;
    const icon = b.status === 'complete' ? art.icon : b.status === 'active' ? '🧭' : '🔒';
    const bossRow = b.boss ? `<li class="node boss ${b.bossDefeated && b.status === 'complete' ? 'complete' : b.bossReady ? 'active' : 'locked'}">
        <span class="icon">${b.bossDefeated && b.status === 'complete' ? '🏆' : BOSSES[b.boss].icon}</span>
        <div><b>Boss: ${esc(BOSSES[b.boss].name)}</b><small>${esc(b.boss)} lore challenge</small></div>
        ${b.bossReady ? `<button class="btn small primary" data-action="boss" data-section="${esc(b.boss)}">Battle</button>` : ''}</li>` : '';
    return `${head}<li class="node ${b.status}">
        <span class="icon" title="${esc(art.name)}">${icon}</span>
        <div><b>${esc(b.name)}</b><small>${b.done}/${b.chapters} chapters · ${esc(b.section)}${b.status === 'complete' ? ` · ${esc(art.name)}` : ''}</small>
          <div class="bar thin"><i style="width:${(b.done / b.chapters) * 100}%"></i></div></div>
        ${b.status !== 'locked' ? `<button class="btn small" data-action="open-book" data-book="${b.num}">${b.status === 'active' ? 'Read' : 'Review'}</button>` : ''}
      </li>${bossRow}`;
  }).join('');
  const earned = state.artifacts.map(n => `<li title="${esc(ARTIFACTS[n].lore)}"><span>${ARTIFACTS[n].icon}</span>${esc(ARTIFACTS[n].name)}</li>`).join('');
  return `<section class="card"><h2>Artifact vault <span class="muted">(${state.artifacts.length}/66)</span></h2>
      ${earned ? `<ul class="vault">${earned}</ul>` : '<p class="muted">Finish a book to earn its artifact. Your first: the Cana Wine Jar, for completing John.</p>'}</section>
    <section class="card"><h2>Testament Quests</h2><p class="muted small">Complete each book to unlock the next. Finishing a section summons a boss battle.</p>
      <ol class="trail">${rows}</ol></section>`;
}

function viewFellowship() {
  const f = ui.fellowship;
  const local = `<section class="card"><h2>Encourage a friend</h2>
      <p class="muted small">Send a streak reminder through WhatsApp, Telegram, SMS or email: one tap, from your own account.</p>
      <form data-action="add-friend" class="row"><input name="name" placeholder="Friend’s name" maxlength="30" required><button class="btn">Add</button></form>
      <ul class="friends">${state.friends.map(fr => `<li><b>${esc(fr.name)}</b>
        <span class="share-row">${shareButtons(fr.name)}</span>
        <button class="icon-btn" data-action="remove-friend" data-id="${fr.id}" aria-label="Remove ${esc(fr.name)}">✕</button></li>`).join('') || '<li class="muted">No friends added yet.</li>'}</ul></section>`;

  if (!S.remoteConfigured()) {
    return `<section class="card"><h2>Congregation mode</h2>
      <p>Pooling reading into a shared monument and the Fellowship leaderboard need the sync server.
      An administrator enables it by filling in <code>quest/config.js</code> (see <code>docs/TESTAMENT_QUEST.md</code>).</p>
      <p class="muted small">Everything else works offline on this device.</p></section>${local}`;
  }
  if (!state.auth) {
    return `<section class="card"><h2>Join your congregation</h2>
      <p>Sign in with a one-time email link to pool your reading, see the Fellowship leaderboard and get automatic streak reminders.</p>
      <form data-action="magic-link" class="row"><input type="email" name="email" placeholder="you@example.com" required><button class="btn primary">Email me a link</button></form></section>${local}`;
  }
  if (!f) { loadFellowship(); return '<section class="card"><p>Loading your Fellowship…</p></section>'; }
  if (f.error) return `<section class="card"><p class="error">${esc(f.error)}</p><button class="btn" data-action="reload-fellowship">Retry</button></section>${local}`;

  if (!f.congregation) {
    return `<section class="card"><h2>Congregation mode</h2>
      <form data-action="create-cong" class="stack"><label>Start a group<input name="name" placeholder="e.g. Riverside Congregation" minlength="2" maxlength="60" required></label><button class="btn primary">Create</button></form>
      <form data-action="join-cong" class="stack"><label>Or join with an invite code<input name="code" placeholder="ABC123" maxlength="6" required></label><button class="btn">Join</button></form></section>
      ${messagingCard()}${local}`;
  }
  const m = E.monumentState(f.monument?.pooled_chapters || 0, f.congregation.goal_laps);
  const board = [...(f.leaderboard || [])].sort((a, b) => b.week_days - a.week_days || b.live_streak - a.live_streak || a.display_name.localeCompare(b.display_name));
  return `<section class="card"><div class="row between"><h2>${esc(f.congregation.name)}</h2><span class="tag">Invite: <b>${esc(f.congregation.invite_code)}</b></span></div>
      ${renderMonument(m)}
      <p><b>${esc(m.name)}</b>: ${m.pooled.toLocaleString()} of ${m.goal.toLocaleString()} chapters read together by ${f.monument?.members || 1} readers.
      ${m.next ? `<span class="muted">${m.next.remaining} more to reach “${esc(m.next.name)}”.</span>` : ''}</p></section>
    <section class="card"><h2>Fellowship leaderboard</h2><p class="muted small">Ranked by days read this week, then streak. Consistency, not speed.</p>
      <table class="board"><thead><tr><th>#</th><th>Reader</th><th>This week</th><th>Streak</th><th></th></tr></thead><tbody>
      ${board.map((r, i) => `<tr class="${r.user_id === state.auth.userId ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.display_name)} <small class="tier-dot tier-${r.tier || 'seeker'}">${esc(r.tier || '')}</small></td>
        <td>${'●'.repeat(r.week_days)}${'○'.repeat(7 - r.week_days)}</td><td>${r.live_streak}🔥</td>
        <td>${r.user_id !== state.auth.userId ? `<button class="btn small" data-action="encourage" data-to="${r.user_id}" data-name="${esc(r.display_name)}" data-streak="${r.live_streak}">Encourage</button>` : ''}</td></tr>`).join('')}
      </tbody></table></section>
    ${messagingCard()}${local}`;
}

function messagingCard() {
  return `<section class="card"><h2>Automatic reminders</h2>
    <p class="muted small">Opt in to receive a 7 pm reminder (your time) when your streak needs today’s chapter, plus encouragement from your Fellowship.</p>
    <label class="check"><input type="checkbox" data-action="opt-in" ${state.profile.encourageOptIn ? 'checked' : ''}> Send me reminders and encouragement</label>
    <button class="btn" data-action="link-telegram">Link Telegram</button>
    <p class="muted small">WhatsApp reminders need the congregation’s WhatsApp Business number to be configured by an administrator.</p></section>`;
}

function shareButtons(name, streak = 0) {
  const text = E.encouragementText({ fromName: state.profile.name || 'A friend', toName: name, streak, appUrl: location.origin + location.pathname });
  const l = E.shareLinks(text);
  return `<a href="${l.whatsapp}" target="_blank" rel="noopener" class="share wa" aria-label="WhatsApp">WhatsApp</a>
    <a href="${l.telegram}" target="_blank" rel="noopener" class="share tg" aria-label="Telegram">Telegram</a>
    <a href="${l.sms}" class="share sms">SMS</a>
    ${navigator.share ? `<button class="share" data-action="native-share" data-text="${esc(text)}">More…</button>` : ''}`;
}

function viewSettings() {
  return `<section class="card"><h2>Settings</h2>
    <form data-action="save-settings" class="stack">
      <label>Display name<input name="name" value="${esc(state.profile.name)}" maxlength="40" required></label>
      <label>Time zone<input name="tz" value="${esc(state.profile.timeZone)}" list="tzs"></label>
      <datalist id="tzs">${(Intl.supportedValuesOf?.('timeZone') || []).map(z => `<option value="${z}">`).join('')}</datalist>
      <button class="btn primary">Save</button></form></section>
    <section class="card"><h2>Your data</h2>
      <p class="muted small">Progress is stored on this device${signedIn() ? ' and synced to your congregation server' : ''}.</p>
      <div class="row"><button class="btn" data-action="export">Export backup</button>
      <label class="btn">Import<input type="file" accept="application/json" data-action="import" hidden></label>
      ${state.auth ? '<button class="btn" data-action="sign-out">Sign out</button>' : ''}
      <button class="btn danger" data-action="reset">Reset all progress</button></div></section>
    <section class="card slim"><p class="muted small">Scripture links open the official New World Translation Study Edition on wol.jw.org and videos on jw.org. This app is an unofficial personal study tool.</p></section>`;
}

// ── Quiz flow ──────────────────────────────────────────────────────────────
async function questionsFor(bookNum, chapter) {
  if (bookNum === 43 && JOHN_QUIZ[chapter]) return { questions: JOHN_QUIZ[chapter], source: 'bank' };
  try {
    const r = await fetch(`/.netlify/functions/quest-quiz?book=${bookNum}&chapter=${chapter}`);
    if (r.ok) return await r.json();
  } catch { /* offline */ }
  return { questions: null, source: 'reflection' };
}

async function startQuiz() {
  const book = currentBook(); if (!book) return;
  const chapter = currentChapter(book);
  ui.busy = true; render();
  const { questions, source } = await questionsFor(book.num, chapter);
  ui.busy = false;
  const items = questions && questions.map(q => {
    const order = shuffle([0, 1, 2, 3]);
    return { ...q, shown: order.map(i => q.options[i]), answerPos: order.indexOf(q.a) };
  });
  const quiz = { book, chapter, items, source };
  ui.quiz = quiz;
  ui.modal = () => quizModal(quiz);
  render();
}

function quizModal(quiz) {
  const title = `${esc(quiz.book.name)} ${quiz.chapter}: retention check`;
  if (!quiz.items) {
    return `<h2>${title}</h2><p>Quiz questions for this chapter are unavailable offline. Write one thing you learned instead.</p>
      <form data-action="submit-reflection" class="stack"><textarea name="note" minlength="20" rows="4" required placeholder="In this chapter I noticed…"></textarea>
      <button class="btn primary">Log my reading</button></form>`;
  }
  return `<h2>${title}</h2><form data-action="submit-quiz" class="quiz">
    ${quiz.items.map((q, i) => `<fieldset><legend>${i + 1}. ${esc(q.q)}</legend>
      ${q.shown.map((o, j) => `<label class="opt"><input type="radio" name="q${i}" value="${j}" required> ${esc(o)}</label>`).join('')}</fieldset>`).join('')}
    <button class="btn primary big">Check answers</button></form>
    <p class="muted small">${quiz.source === 'ai' ? 'Questions generated for this chapter; verify against your reading.' : ''}</p>`;
}

async function submitQuiz(form) {
  const quiz = ui.quiz;
  const answers = quiz.items.map((q, i) => Number(new FormData(form).get(`q${i}`)));
  const graded = E.gradeQuiz(quiz.items.map(q => ({ a: q.answerPos })), answers);
  if (!graded.passed) {
    ui.modal = () => `<h2>Almost: ${graded.correct}/${graded.total}</h2>
      <p>Review these verses, then try again. You need 2 of 3.</p>
      <ul class="review">${quiz.items.map((q, i) => answers[i] === q.answerPos ? '' :
        `<li>${esc(q.q)}<br><a href="${verseUrl(quiz.book.num, q.ref)}" target="_blank" rel="noopener">Read ${esc(q.ref)} →</a></li>`).join('')}</ul>
      <button class="btn primary" data-action="quiz">Retry quiz</button>`;
    render(); return;
  }
  await recordReading(quiz.book.num, quiz.chapter, graded.correct, graded.total);
}

async function recordReading(bookNum, chapter, correct, total) {
  const today = S.today(state);
  const beforeTier = E.tierFor(state.streak.longest);
  const { streak, event } = E.applyReadingDay(state.streak, today);
  const result = E.completeChapter(state.progress, bookNum, chapter);
  state.streak = streak;
  state.progress = result.progress;
  if (result.bookCompleted && !state.artifacts.includes(bookNum)) state.artifacts.push(bookNum);
  if (event !== 'same-day') state.recentDays = [today, ...state.recentDays].slice(0, 30);
  state.log.unshift({ day: today, book: bookNum, chapter, correct, total });
  state.log = state.log.slice(0, 500);
  ui.chapter = null; ui.book = null;

  let syncNote = '';
  if (signedIn()) {
    try {
      state.auth = await S.remote.refresh(state);
      const r = await S.remote.logReading(state, bookNum, chapter, correct, total);
      // Server is the source of truth for streak numbers.
      Object.assign(state.streak, { current: r.current_streak, longest: r.longest_streak, totalDays: r.total_days_read,
        shields: r.shields, lastDay: r.read_day });
      ui.fellowship = null;
    } catch (e) { syncNote = `Saved on this device; sync failed (${e.message}).`; }
  }
  persist();

  const afterTier = E.tierFor(state.streak.longest);
  const lines = [];
  const msg = { started: 'Your streak has begun! 🔥', extended: `Streak extended to ${state.streak.current} days! 🔥`,
    'shield-used': `A shield covered your missed day. Streak: ${state.streak.current} days 🛡️`,
    reset: 'A fresh start: streak day 1. Every faithful day counts. 🌱', 'same-day': 'Extra reading logged. Today already counts. 📚' }[event];
  if (msg) lines.push(msg);
  if (afterTier && afterTier !== beforeTier) lines.push(`🏛️ <b>${afterTier.name} tier reached!</b> Your sanctuary grows: ${esc(afterTier.sanctuary)}.`);
  if (result.bookCompleted) {
    const a = ARTIFACTS[bookNum];
    lines.push(`${a.icon} <b>Artifact earned: ${esc(a.name)}</b><br><i>${esc(a.lore)}</i>`);
  }
  if (result.unlocked) lines.push(`🔓 <b>${esc(E.BOOK_BY_NUM[result.unlocked].name)}</b> is unlocked!`);
  if (result.boss) lines.push(`${BOSSES[result.boss].icon} <b>Boss battle available:</b> ${esc(BOSSES[result.boss].name)}`);
  if (!result.newChapter) lines.push('This chapter was already complete, so it counts as review reading.');
  if (syncNote) lines.push(`<span class="muted small">${esc(syncNote)}</span>`);

  ui.modal = () => `<div class="celebrate"><h2>Well done!</h2>${lines.map(l => `<p>${l}</p>`).join('')}
    <button class="btn primary" data-action="close-modal">Continue</button></div>`;
  render();
}

// ── Boss battles ───────────────────────────────────────────────────────────
function startBoss(section) {
  const boss = BOSSES[section];
  const items = boss.questions.map(q => {
    const order = shuffle(q.options.map((_, i) => i));
    return { ...q, shown: order.map(i => q.options[i]), answerPos: order.indexOf(q.a) };
  });
  ui.boss = { section, items };
  ui.modal = () => `<h2>${boss.icon} ${esc(boss.name)}</h2><p class="muted small">Answer 3 of 4 correctly to prevail.</p>
    <form data-action="submit-boss" class="quiz">${items.map((q, i) => `<fieldset><legend>${i + 1}. ${esc(q.q)}</legend>
      ${q.shown.map((o, j) => `<label class="opt"><input type="radio" name="q${i}" value="${j}" required> ${esc(o)}</label>`).join('')}</fieldset>`).join('')}
    <button class="btn primary big">Strike!</button></form>`;
  render();
}

async function submitBoss(form) {
  const { section, items } = ui.boss;
  const fd = new FormData(form);
  const correct = items.filter((q, i) => Number(fd.get(`q${i}`)) === q.answerPos).length;
  const won = correct * 4 >= items.length * 3;
  if (won) {
    state.progress = E.defeatBoss(state.progress, section);
    if (signedIn()) { try { await S.remote.bossVictory(state, section, correct, items.length); } catch { /* local win stands */ } }
    persist();
    const next = E.activeBook(state.progress);
    ui.modal = () => `<div class="celebrate"><h2>🏆 Victory! ${correct}/${items.length}</h2>
      <p>You conquered <b>${esc(BOSSES[section].name)}</b>.</p>${next ? `<p>🔓 <b>${esc(next.name)}</b> is now unlocked.</p>` : ''}
      <button class="btn primary" data-action="close-modal">Onward</button></div>`;
  } else {
    ui.modal = () => `<h2>The battle continues: ${correct}/${items.length}</h2><p>Review the section and challenge the boss again whenever you are ready.</p>
      <button class="btn primary" data-action="boss" data-section="${esc(section)}">Try again</button>`;
  }
  render();
}

// ── Fellowship (remote) ────────────────────────────────────────────────────
async function loadFellowship() {
  try {
    state.auth = await S.remote.refresh(state); persist();
    const congs = await S.remote.myCongregations(state);
    const congregation = congs.find(c => c.id === state.congregationId) || congs[0] || null;
    let monument = null, leaderboard = [];
    if (congregation) {
      state.congregationId = congregation.id; persist();
      [monument, leaderboard] = await Promise.all([S.remote.monument(state, congregation.id), S.remote.leaderboard(state, congregation.id)]);
    }
    ui.fellowship = { congregation, monument, leaderboard };
  } catch (e) { ui.fellowship = { error: `Could not reach the Fellowship server: ${e.message}` }; }
  if (ui.tab === 'fellowship') render();
}

// ── Events ─────────────────────────────────────────────────────────────────
const actions = {
  'close-modal': () => { ui.modal = null; render(); },
  'pick-chapter': el => { ui.book = currentBook().num; ui.chapter = Number(el.value); render(); },
  quiz: () => { ui.modal = null; startQuiz(); },
  boss: el => startBoss(el.dataset.section),
  'open-book': el => { ui.book = Number(el.dataset.book); ui.chapter = null; ui.tab = 'today'; render(); scrollTo(0, 0); },
  'add-friend': form => { const name = new FormData(form).get('name').trim(); if (!name) return;
    state.friends.push({ id: crypto.randomUUID(), name }); persist(); render(); },
  'remove-friend': el => { state.friends = state.friends.filter(f => f.id !== el.dataset.id); persist(); render(); },
  'native-share': el => navigator.share({ text: el.dataset.text }).catch(() => {}),
  'magic-link': async form => {
    try { await S.remote.sendMagicLink(state, new FormData(form).get('email')); toast('Check your email for the sign-in link.'); }
    catch (e) { toast(`Sign-in failed: ${e.message}`); }
  },
  'reload-fellowship': () => { ui.fellowship = null; render(); },
  'create-cong': async form => {
    try { const c = await S.remote.createCongregation(state, new FormData(form).get('name').trim()); state.congregationId = c.id; persist(); ui.fellowship = null; render(); }
    catch (e) { toast(e.message); }
  },
  'join-cong': async form => {
    try { state.congregationId = await S.remote.joinCongregation(state, new FormData(form).get('code')); persist(); ui.fellowship = null; render(); toast('Welcome to the congregation!'); }
    catch (e) { toast(e.message); }
  },
  encourage: async el => {
    const { to, name, streak } = el.dataset;
    el.disabled = true;
    try {
      const r = await S.remote.encourage(state, to);
      if (r.delivered) { toast(`Encouragement sent to ${name} via ${r.channel}.`); return; }
      if (r.error) { toast(r.error); return; }
    } catch { /* fall through to share sheet */ }
    ui.modal = () => `<h2>Encourage ${esc(name)}</h2><p class="muted small">${esc(name)} hasn’t linked a messaging app for automatic delivery. Send it yourself:</p>
      <div class="share-row">${shareButtons(name, Number(streak))}</div>`;
    render();
  },
  'opt-in': async el => {
    state.profile.encourageOptIn = el.checked; persist();
    if (signedIn()) { try { await S.remote.upsertProfile(state); toast(el.checked ? 'Reminders on.' : 'Reminders off.'); } catch (e) { toast(e.message); } }
  },
  'link-telegram': async () => {
    try { const r = await S.remote.telegramLink(state); if (r.url) window.open(r.url, '_blank', 'noopener'); else toast(r.error || 'Telegram unavailable'); }
    catch (e) { toast(e.message); }
  },
  'save-settings': async form => {
    const fd = new FormData(form);
    const tz = fd.get('tz').trim();
    try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { toast('Unknown time zone'); return; }
    state.profile.name = fd.get('name').trim(); state.profile.timeZone = tz; persist();
    if (signedIn()) { try { await S.remote.upsertProfile(state); } catch (e) { toast(e.message); return; } }
    toast('Saved.'); render();
  },
  export: () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ ...state, auth: null }, null, 2)], { type: 'application/json' }));
    a.download = `testament-quest-${S.today(state)}.json`; a.click();
  },
  import: async el => {
    try { const data = JSON.parse(await el.files[0].text()); if (!data.streak || !data.progress) throw new Error('not a backup');
      state = { ...S.defaultState(), ...data, auth: state.auth }; persist(); toast('Backup restored.'); render(); }
    catch (e) { toast(`Import failed: ${e.message}`); }
  },
  'sign-out': () => { state.auth = null; ui.fellowship = null; persist(); render(); },
  reset: () => { if (confirm('Erase all progress on this device? This cannot be undone.')) { S.reset(); state = S.load(); render(); } },
  'submit-quiz': form => submitQuiz(form),
  'submit-boss': form => submitBoss(form),
  'submit-reflection': form => { const q = ui.quiz; if (new FormData(form).get('note').trim().length >= 20) recordReading(q.book.num, q.chapter, 1, 1); },
  onboard: async form => {
    state.profile.name = new FormData(form).get('name').trim(); persist(); ui.modal = null;
    if (signedIn()) { try { await S.remote.upsertProfile(state); } catch { /* retried on save */ } }
    render();
  },
};

document.addEventListener('click', e => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { ui.tab = tab.dataset.tab; ui.modal = null; render(); return; }
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'FORM' || el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'file') return;
  e.preventDefault(); actions[el.dataset.action]?.(el);
});
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-action]'); if (!f) return;
  e.preventDefault(); actions[f.dataset.action]?.(f);
});
document.addEventListener('change', e => {
  const el = e.target.closest('select[data-action], input[type=checkbox][data-action], input[type=file][data-action]');
  if (el) actions[el.dataset.action]?.(el);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.modal) { ui.modal = null; render(); } });

// ── Boot ───────────────────────────────────────────────────────────────────
const auth = S.remoteConfigured() && S.remote.consumeRedirect();
if (auth) { state.auth = auth; persist(); ui.tab = 'fellowship'; S.remote.upsertProfile(state).catch(() => {}); }
if (!state.profile.name) {
  ui.modal = () => `<h2>Welcome to Testament Quest</h2>
    <p>Read one chapter a day, answer a 3-question check, and watch your sanctuary grow from a single altar stone to a completed house of worship.</p>
    <ul class="muted small"><li><b>Foundation</b>: 7 days</li><li><b>Growth</b>: 30 days</li><li><b>Mastery</b>: 90 days</li></ul>
    <form data-action="onboard" class="stack"><label>What should we call you?<input name="name" maxlength="40" required autofocus></label>
    <button class="btn primary big">Begin with the Gospel of John</button></form>`;
}
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(() => {});
