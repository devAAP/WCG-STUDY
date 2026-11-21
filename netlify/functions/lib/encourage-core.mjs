// Delivery core for automated streak encouragement. Pure apart from the
// injected `fetch`, so it is unit-tested without network access.
//
// Channels:
//   telegram — Bot API sendMessage. Recipient must have started the bot once
//              (Telegram's rule); we store their chat_id at that moment.
//   whatsapp — WhatsApp Cloud API. Business-initiated messages MUST use a
//              pre-approved template (Meta policy), so free text is impossible;
//              the template takes {{1}} = sender/app name, {{2}} = streak days.
// iMessage/SMS/Messenger have no consented bot channel for this, so the app
// falls back to a one-tap share sheet for those (see quest/js/app.js).

export const NUDGE_LOCAL_HOUR = 19; // 7 pm in the recipient's own time zone

export function nudgeText({ name, streak, fromName }) {
  const who = fromName ? `${fromName} is cheering you on` : 'Your Fellowship is cheering you on';
  return streak > 0
    ? `${who}, ${name}! Your ${streak}-day reading streak needs today’s chapter. 📖 “Your word is a lamp to my foot.” — Psalm 119:105`
    : `${who}, ${name}! Today is a great day to start a fresh reading streak. 📖`;
}

export function pickChannel(p) {
  if (p.telegram_chat_id) return 'telegram';
  if (p.whatsapp_e164) return 'whatsapp';
  return null;
}

export async function deliver({ fetch, env, channel, recipient, text, streak, fromName }) {
  if (channel === 'telegram') {
    if (!env.TELEGRAM_BOT_TOKEN) return { status: 'skipped', error: 'telegram not configured' };
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: recipient.telegram_chat_id, text }),
    });
    const body = await r.json().catch(() => ({}));
    return body.ok ? { status: 'sent', id: String(body.result?.message_id ?? '') }
                   : { status: 'failed', error: body.description || `HTTP ${r.status}` };
  }
  if (channel === 'whatsapp') {
    if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID || !env.WHATSAPP_TEMPLATE) {
      return { status: 'skipped', error: 'whatsapp not configured' };
    }
    const r = await fetch(`https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: recipient.whatsapp_e164.replace('+', ''), type: 'template',
        template: {
          name: env.WHATSAPP_TEMPLATE, language: { code: env.WHATSAPP_TEMPLATE_LANG || 'en' },
          components: [{ type: 'body', parameters: [
            { type: 'text', text: fromName || 'Your Fellowship' },
            { type: 'text', text: String(streak) },
          ] }],
        },
      }),
    });
    const body = await r.json().catch(() => ({}));
    return r.ok ? { status: 'sent', id: body.messages?.[0]?.id ?? '' }
                : { status: 'failed', error: body.error?.message || `HTTP ${r.status}` };
  }
  return { status: 'skipped', error: 'no channel' };
}

// Minimal Supabase REST client using the service-role key (server only).
export function supabase({ fetch, env }) {
  const base = `${env.SUPABASE_URL}/rest/v1`;
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
  const call = async (path, init = {}) => {
    const r = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...init.headers } });
    const text = await r.text();
    const body = text ? JSON.parse(text) : null;
    if (!r.ok) { const e = new Error(body?.message || `HTTP ${r.status}`); e.status = r.status; e.code = body?.code; throw e; }
    return body;
  };
  return {
    candidates: () => call('/encouragement_candidates?select=*'),
    profile: id => call(`/profiles?id=eq.${encodeURIComponent(id)}&select=*`).then(r => r[0] || null),
    inFellowship: (a, b) => call('/rpc/in_fellowship', { method: 'POST', body: JSON.stringify({ a, b }) }),
    // Insert first: the daily unique index makes this the anti-spam lock.
    claim: row => call('/encouragements', {
      method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row),
    }).then(r => r[0]),
    finish: (id, patch) => call(`/encouragements?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  };
}

// Hourly sweep: nudge opted-in readers whose streak is savable, at their 7 pm.
export async function runSweep({ db, fetch, env, now = new Date() }) {
  const rows = await db.candidates();
  const results = [];
  for (const p of rows) {
    if (p.local_hour !== NUDGE_LOCAL_HOUR) continue;
    const channel = pickChannel(p);
    if (!channel) continue;
    const text = nudgeText({ name: p.display_name, streak: p.current_streak });
    let claimed;
    try {
      claimed = await db.claim({ from_user: null, to_user: p.id, channel, message: text, send_day: p.local_today });
    } catch (e) {
      if (e.code === '23505') continue; // already nudged today
      throw e;
    }
    const out = await deliver({ fetch, env, channel, recipient: p, text, streak: p.current_streak });
    await db.finish(claimed.id, { status: out.status, provider_message_id: out.id ?? null, error: out.error ?? null });
    results.push({ to: p.id, channel, ...out });
  }
  return results;
}

// Friend-initiated: an authenticated reader taps "Encourage" on a friend.
export async function sendFromFriend({ db, fetch, env, fromId, toId }) {
  if (fromId === toId) return { status: 400, body: { error: 'Cannot encourage yourself' } };
  if (!(await db.inFellowship(fromId, toId))) return { status: 403, body: { error: 'Not in your Fellowship' } };
  const [from, to] = await Promise.all([db.profile(fromId), db.profile(toId)]);
  if (!to) return { status: 404, body: { error: 'Unknown reader' } };
  const channel = to.encourage_opt_in ? pickChannel(to) : null;
  if (!channel) return { status: 200, body: { delivered: false, reason: 'friend has no linked messaging app — use Share' } };
  const text = nudgeText({ name: to.display_name, streak: to.current_streak, fromName: from?.display_name });
  let claimed;
  try {
    claimed = await db.claim({ from_user: fromId, to_user: toId, channel, message: text });
  } catch (e) {
    if (e.code === '23505') return { status: 429, body: { error: 'You already encouraged them today' } };
    throw e;
  }
  const out = await deliver({ fetch, env, channel, recipient: to, text, streak: to.current_streak, fromName: from?.display_name });
  await db.finish(claimed.id, { status: out.status, provider_message_id: out.id ?? null, error: out.error ?? null });
  return { status: 200, body: { delivered: out.status === 'sent', channel, status: out.status } };
}
