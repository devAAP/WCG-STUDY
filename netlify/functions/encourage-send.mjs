// POST /.netlify/functions/encourage-send  { to: <user uuid> }
// Authorization: Bearer <Supabase user access token>
import { sendFromFriend, supabase } from './lib/encourage-core.mjs';

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: '{"error":"POST only"}' };
  const env = process.env;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 503, headers: HEADERS, body: '{"error":"Fellowship server not configured"}' };
  }
  const token = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!token || !who.ok) return { statusCode: 401, headers: HEADERS, body: '{"error":"Sign in first"}' };
  const { id: fromId } = await who.json();
  let toId;
  try { toId = JSON.parse(event.body || '{}').to; } catch { /* fallthrough */ }
  if (typeof toId !== 'string') return { statusCode: 400, headers: HEADERS, body: '{"error":"Missing recipient"}' };
  const out = await sendFromFriend({ db: supabase({ fetch, env }), fetch, env, fromId, toId });
  return { statusCode: out.status, headers: HEADERS, body: JSON.stringify(out.body) };
};
