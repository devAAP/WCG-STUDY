// GET  (Authorization: Bearer <Supabase token>) → { url } signed bot deep link.
// POST (Telegram webhook; header X-Telegram-Bot-Api-Secret-Token must match
//       TELEGRAM_WEBHOOK_SECRET) → binds chat_id on "/start <payload>".
// Setup: setWebhook with url=<site>/.netlify/functions/telegram and
//        secret_token=<TELEGRAM_WEBHOOK_SECRET>.
import { signStart, verifyStart } from './lib/telegram-link.mjs';

const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
const out = (statusCode, body) => ({ statusCode, headers: H, body: JSON.stringify(body) });

export const handler = async (event) => {
  const env = process.env;
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: H, body: '' };
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_BOT_USERNAME || !env.TELEGRAM_WEBHOOK_SECRET || !env.SUPABASE_URL) {
    return out(503, { error: 'Telegram not configured' });
  }
  const svc = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };

  if (event.httpMethod === 'GET') {
    const token = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { ...svc, Authorization: `Bearer ${token}` } });
    if (!token || !who.ok) return out(401, { error: 'Sign in first' });
    const { id } = await who.json();
    return out(200, { url: `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${signStart(id, env.TELEGRAM_WEBHOOK_SECRET)}` });
  }

  if (event.httpMethod === 'POST') {
    if (event.headers['x-telegram-bot-api-secret-token'] !== env.TELEGRAM_WEBHOOK_SECRET) return out(401, { error: 'bad secret' });
    const msg = JSON.parse(event.body || '{}').message;
    const m = /^\/start\s+(\S+)/.exec(msg?.text || '');
    const userId = m && verifyStart(m[1], env.TELEGRAM_WEBHOOK_SECRET);
    const reply = text => fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: msg.chat.id, text }) });
    if (/^\/stop\b/.test(msg?.text || '')) {
      await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?telegram_chat_id=eq.${encodeURIComponent(String(msg.chat.id))}`, {
        method: 'PATCH', headers: { ...svc, 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegram_chat_id: null, encourage_opt_in: false }),
      });
      await reply('Unlinked. You will not receive any more encouragement messages here.');
      return out(200, {});
    }
    if (!userId) { if (msg?.chat) await reply('Open this bot from the Testament Quest app to link your account.'); return out(200, {}); }
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH', headers: { ...svc, 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_chat_id: String(msg.chat.id), encourage_opt_in: true }),
    });
    await reply(r.ok ? 'Linked! Your Fellowship can now cheer you on here. Send /stop any time to opt out.'
                     : 'Sorry, linking failed — please try again from the app.');
    return out(200, {});
  }
  return out(405, { error: 'method not allowed' });
};
