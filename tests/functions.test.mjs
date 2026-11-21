import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../netlify/functions/lib/encourage-core.mjs';
import { handler as quizHandler, validQuiz } from '../netlify/functions/quest-quiz.mjs';

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const key = Object.keys(routes).find(k => url.includes(k));
    const [status, body] = routes[key] ?? [404, {}];
    return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  fn.calls = calls;
  return fn;
}

function fakeDb({ candidates = [], profiles = {}, fellowship = true, dupe = false } = {}) {
  const claimed = [], finished = [];
  return {
    claimed, finished,
    candidates: async () => candidates,
    profile: async id => profiles[id] ?? null,
    inFellowship: async () => fellowship,
    claim: async row => { if (dupe) { const e = new Error('dup'); e.code = '23505'; throw e; } claimed.push(row); return { id: claimed.length }; },
    finish: async (id, patch) => finished.push({ id, ...patch }),
  };
}

const env = { TELEGRAM_BOT_TOKEN: 'T', WHATSAPP_TOKEN: 'W', WHATSAPP_PHONE_ID: 'P', WHATSAPP_TEMPLATE: 'streak_nudge' };

test('sweep nudges only at 7 pm local, via the linked channel', async () => {
  const db = fakeDb({ candidates: [
    { id: 'a', display_name: 'Ama', current_streak: 12, telegram_chat_id: '42', local_hour: 19, local_today: '2026-11-21' },
    { id: 'b', display_name: 'Kofi', current_streak: 3, whatsapp_e164: '+233200000000', local_hour: 19, local_today: '2026-11-21' },
    { id: 'c', display_name: 'Esi', current_streak: 5, telegram_chat_id: '7', local_hour: 8, local_today: '2026-11-21' },
    { id: 'd', display_name: 'Yaw', current_streak: 5, local_hour: 19, local_today: '2026-11-21' },
  ]});
  const fetch = fakeFetch({ 'api.telegram.org': [200, { ok: true, result: { message_id: 9 } }],
                            'graph.facebook.com': [200, { messages: [{ id: 'wamid.1' }] }] });
  const out = await C.runSweep({ db, fetch, env });
  assert.deepEqual(out.map(r => [r.to, r.channel, r.status]), [['a', 'telegram', 'sent'], ['b', 'whatsapp', 'sent']]);
  assert.equal(fetch.calls[0].body.chat_id, '42');
  assert.match(fetch.calls[0].body.text, /12-day/);
  const wa = fetch.calls[1].body;
  assert.equal(wa.type, 'template');
  assert.equal(wa.to, '233200000000');
  assert.equal(wa.template.components[0].parameters[1].text, '3');
  assert.equal(db.finished[0].status, 'sent');
});

test('sweep skips readers already nudged today', async () => {
  const db = fakeDb({ dupe: true, candidates: [{ id: 'a', display_name: 'Ama', current_streak: 2, telegram_chat_id: '1', local_hour: 19 }] });
  const fetch = fakeFetch({});
  assert.deepEqual(await C.runSweep({ db, fetch, env }), []);
  assert.equal(fetch.calls.length, 0);
});

test('provider failures are recorded, not thrown', async () => {
  const db = fakeDb({ candidates: [{ id: 'a', display_name: 'Ama', current_streak: 2, telegram_chat_id: '1', local_hour: 19 }] });
  const fetch = fakeFetch({ 'api.telegram.org': [403, { ok: false, description: 'bot was blocked by the user' }] });
  const [r] = await C.runSweep({ db, fetch, env });
  assert.equal(r.status, 'failed');
  assert.equal(db.finished[0].error, 'bot was blocked by the user');
});

test('friend encouragement enforces fellowship, consent and daily limit', async () => {
  const profiles = {
    me: { id: 'me', display_name: 'Ama' },
    pal: { id: 'pal', display_name: 'Kofi', current_streak: 4, encourage_opt_in: true, telegram_chat_id: '5' },
    shy: { id: 'shy', display_name: 'Esi', current_streak: 4, encourage_opt_in: false, telegram_chat_id: '6' },
  };
  const fetch = fakeFetch({ 'api.telegram.org': [200, { ok: true, result: { message_id: 1 } }] });
  assert.equal((await C.sendFromFriend({ db: fakeDb({ profiles, fellowship: false }), fetch, env, fromId: 'me', toId: 'pal' })).status, 403);
  const shy = await C.sendFromFriend({ db: fakeDb({ profiles }), fetch, env, fromId: 'me', toId: 'shy' });
  assert.equal(shy.body.delivered, false);
  const ok = await C.sendFromFriend({ db: fakeDb({ profiles }), fetch, env, fromId: 'me', toId: 'pal' });
  assert.deepEqual(ok.body, { delivered: true, channel: 'telegram', status: 'sent' });
  assert.match(fetch.calls.at(-1).body.text, /^Ama is cheering you on, Kofi!/);
  assert.equal((await C.sendFromFriend({ db: fakeDb({ profiles, dupe: true }), fetch, env, fromId: 'me', toId: 'pal' })).status, 429);
});

test('missing provider config skips instead of failing', async () => {
  const out = await C.deliver({ fetch: fakeFetch({}), env: {}, channel: 'whatsapp', recipient: { whatsapp_e164: '+1555' }, text: 'x', streak: 1 });
  assert.equal(out.status, 'skipped');
});

test('quiz endpoint validates input before spending a model call', async () => {
  const bad = await quizHandler({ httpMethod: 'GET', queryStringParameters: { book: '43', chapter: '22' } });
  assert.equal(bad.statusCode, 400);
  const post = await quizHandler({ httpMethod: 'POST', queryStringParameters: {} });
  assert.equal(post.statusCode, 405);
  const saved = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  const noKey = await quizHandler({ httpMethod: 'GET', queryStringParameters: { book: '1', chapter: '1' } });
  if (saved) process.env.ANTHROPIC_API_KEY = saved;
  assert.equal(noKey.statusCode, 503);
});

test('generated quizzes are validated strictly', () => {
  const good = { questions: [0, 1, 2].map(i => ({ q: 'Who was created first?', options: ['A', 'B', 'C', 'D'], a: i, ref: 'Genesis 2:7' })) };
  assert.equal(validQuiz(good, 'Genesis'), true);
  assert.equal(validQuiz({ questions: good.questions.slice(0, 2) }, 'Genesis'), false);
  assert.equal(validQuiz({ questions: good.questions.map(q => ({ ...q, a: 4 })) }, 'Genesis'), false);
  assert.equal(validQuiz(good, 'Exodus'), false);
});

import { signStart, verifyStart } from '../netlify/functions/lib/telegram-link.mjs';
test('telegram start payloads are signed, compact and tamper-proof', () => {
  const id = '11111111-2222-3333-4444-555555555555';
  const p = signStart(id, 's3cret');
  assert.ok(p.length <= 64 && /^[A-Za-z0-9_]+$/.test(p));
  assert.equal(verifyStart(p, 's3cret'), id);
  assert.equal(verifyStart(p, 'other'), null);
  assert.equal(verifyStart(p.replace(/^1/, '9'), 's3cret'), null);
  assert.equal(verifyStart('junk', 's3cret'), null);
});
